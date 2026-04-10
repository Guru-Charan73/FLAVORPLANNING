sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/m/Input",
    "sap/m/Label",
    "sap/ui/table/Column",
    "sap/ui/core/CustomData",
    "sap/ui/core/format/DateFormat",
    "sap/m/VBox",
    "sap/m/HBox",
    "sap/m/ObjectStatus",
    "sap/m/ObjectNumber",
    "sap/ui/core/Fragment",
    "sap/m/Token",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/comp/valuehelpdialog/ValueHelpDialog",
    "sap/ui/model/type/String",
    "sap/ui/model/type/Float",
    "sap/ui/core/Item"
], (Controller, JSONModel, MessageToast, MessageBox, Input, Label, Column, CustomData, DateFormat, VBox, HBox, ObjectStatus, ObjectNumber, Fragment, Token, Filter, FilterOperator, ValueHelpDialog, TypeString, TypeFloat, CoreItem) => {
    "use strict";

    return Controller.extend("flavournamespace.flavourmodule.controller.Main", {

        // =========================================================
        // 1. INITIALIZATION & SETUP
        // =========================================================
        onInit() {
            // Expose controller to window for easy debugging in Chrome console
            window.myDebug = this; 

            // Create and set the primary JSON model that holds the TreeTable data
            const oEmptyModel = new JSONModel({ mrpData: this._getEmptySkeleton() });
            this.getView().setModel(oEmptyModel);

            // Create a backup model to remember the "Old Quantity" before user edits a cell
            this._oBackupModel = new JSONModel({ mrpData: this._getEmptySkeleton() });

            // Create a local model to hold raw OData, UI states, and generated columns
            const oLocalModel = new JSONModel({
                RawData: [],        // Stores the flat data exactly as it came from SAP
                PopoverConfig: {},  // Configures the title/labels for the PR/PO popover
                SelectedItems: [],  // Stores the PRs/POs tied to the clicked cell
                TimeBuckets: []     // Stores the dynamically generated W1-W54 column headers
            });
            this.getView().setModel(oLocalModel, "localModel");

            // Bind the TreeTable to the JSON model explicitly pointing to the 'nodes' array
            const oTreeTable = this.byId("idMrpTreeTable");
            if (oTreeTable) {
                oTreeTable.bindRows({
                    path: "/mrpData",
                    parameters: { arrayNames: ["nodes"] }
                });
            }

            // Initialize the payload array that will hold only the cells the user changed
            this._aChangeLog = []; 

            // A helper function to force typed tokens in the MultiInputs to be uppercase
            const fnTokenValidator = args => {
                let sText = args.text.toUpperCase(); 
                let sKey = sText;
                if (sKey.startsWith("=")) { sKey = sKey.substring(1); } // Remove '=' if typed
                return new Token({ key: sKey, text: sText });
            };

            // Attach the uppercase validator and live-change uppercase enforcer to the input fields
            ["inpPlant", "inpMaterial", "inpVendor"].forEach(id => {
                const oInput = this.byId(id);
                if (oInput) {
                    oInput.addValidator(fnTokenValidator);
                    oInput.attachLiveChange(function(oEvent) {
                        let sValue = oEvent.getParameter("value");
                        if (sValue !== sValue.toUpperCase()) {
                            oEvent.getSource().setValue(sValue.toUpperCase());
                        }
                    });
                }
            });

            // Load any saved variants from local storage on startup
            this._loadVariants();
        },

        // =========================================================
        // 2. VARIANT MANAGEMENT (Saving user filter preferences)
        // =========================================================
        _loadVariants() {
            const oVM = this.byId("idVariantManagement");
            const sData = localStorage.getItem("flavorVariants"); // Fetch saved variants
            
            // Parse saved variants or create an empty array
            if (sData) {
                this._aCustomVariants = JSON.parse(sData);
                this._aCustomVariants.forEach(v => {
                    oVM.addItem(new CoreItem({ key: v.key, text: v.name })); // Populate dropdown
                });
            } else {
                this._aCustomVariants = [];
            }

            // Check if user set a default variant, apply it automatically if found
            const sDef = localStorage.getItem("flavorDefVariant");
            if (sDef) {
                oVM.setDefaultVariantKey(sDef);
                oVM.setInitialSelectionKey(sDef);
                setTimeout(() => this._applyVariant(sDef), 300); // Delay allows UI to render first
            }
        },

        onSaveVariant(oEvent) {
            // Extract save parameters from the VariantManagement control
            const sName = oEvent.getParameter("name");
            const bOverwrite = oEvent.getParameter("overwrite");
            const bDefault = oEvent.getParameter("def");
            let sKey = oEvent.getParameter("key");

            // Helper to pull all tokens from a MultiInput
            const fnGetTokens = (id) => this.byId(id).getTokens().map(t => ({ key: t.getKey(), text: t.getText(), range: t.data("range") }));

            // Build an object containing the current state of all filter fields
            const oState = {
                material: fnGetTokens("inpMaterial"),
                plant: fnGetTokens("inpPlant"),
                vendor: fnGetTokens("inpVendor"),
                dateStart: this.byId("inpDateRange").getDateValue(),
                dateEnd: this.byId("inpDateRange").getSecondDateValue(),
                period: this.byId("inpPeriod").getSelectedKey()
            };

            // Update existing variant or push a brand new one
            if (bOverwrite) {
                const oVar = this._aCustomVariants.find(v => v.key === sKey);
                if (oVar) oVar.state = oState;
            } else {
                sKey = "var_" + Date.now(); // Generate unique key
                this._aCustomVariants.push({ key: sKey, name: sName, state: oState });
                this.byId("idVariantManagement").addItem(new CoreItem({ key: sKey, text: sName }));
            }

            // Save default preference if checked
            if (bDefault) {
                this.byId("idVariantManagement").setDefaultVariantKey(sKey);
                localStorage.setItem("flavorDefVariant", sKey);
            }

            // Commit to browser local storage
            localStorage.setItem("flavorVariants", JSON.stringify(this._aCustomVariants));
            MessageToast.show("Variant saved successfully.");
        },

        onSelectVariant(oEvent) {
            // Triggered when user picks a variant from the dropdown
            const sKey = oEvent.getParameter("key");
            this._applyVariant(sKey);
        },

        _applyVariant(sKey) {
            // If they pick the standard/empty variant, clear all fields
            if (sKey === "*standard*") {
                this.byId("inpMaterial").removeAllTokens();
                this.byId("inpPlant").removeAllTokens();
                this.byId("inpVendor").removeAllTokens();
                this.byId("inpDateRange").setValue("");
                this.byId("inpPeriod").setSelectedKey("W");
                return;
            }

            // Find the variant in array and apply its saved state to the UI
            const oVariant = this._aCustomVariants.find(v => v.key === sKey);
            if (oVariant) {
                const fnSetTokens = (id, aToks) => {
                    const oInp = this.byId(id);
                    oInp.removeAllTokens();
                    if (aToks) {
                        aToks.forEach(t => {
                            const oTok = new Token({ key: t.key, text: t.text });
                            if (t.range) oTok.data("range", t.range);
                            oInp.addToken(oTok);
                        });
                    }
                };
                
                fnSetTokens("inpMaterial", oVariant.state.material);
                fnSetTokens("inpPlant", oVariant.state.plant);
                fnSetTokens("inpVendor", oVariant.state.vendor);
                
                if (oVariant.state.dateStart) this.byId("inpDateRange").setDateValue(new Date(oVariant.state.dateStart));
                if (oVariant.state.dateEnd) this.byId("inpDateRange").setSecondDateValue(new Date(oVariant.state.dateEnd));
                
                this.byId("inpPeriod").setSelectedKey(oVariant.state.period || "W");
                this.onSearch(); // Automatically execute search after applying variant
            }
        },

        onManageVariant(oEvent) {
            // Handles deleting, renaming, or changing the default variant via the manage dialog
            const aDeleted = oEvent.getParameter("deleted") || [];
            const aRenamed = oEvent.getParameter("renamed") || [];
            const sDef = oEvent.getParameter("def");
            const oVM = this.byId("idVariantManagement");

            aDeleted.forEach(sDelKey => {
                this._aCustomVariants = this._aCustomVariants.filter(v => v.key !== sDelKey);
                oVM.removeItem(oVM.getItemByKey(sDelKey));
                if (localStorage.getItem("flavorDefVariant") === sDelKey) {
                    localStorage.removeItem("flavorDefVariant");
                }
            });

            aRenamed.forEach(oRename => {
                const oVar = this._aCustomVariants.find(v => v.key === oRename.key);
                if (oVar) oVar.name = oRename.name;
            });

            if (sDef !== undefined) {
                localStorage.setItem("flavorDefVariant", sDef);
            }

            localStorage.setItem("flavorVariants", JSON.stringify(this._aCustomVariants));
        },

        // =========================================================
        // 3. TREE TABLE SKELETON & MAPPING LOGIC
        // =========================================================
        _getEmptySkeleton() {
            // Generates 54 empty week properties (W1: 0, W2: 0, etc.)
            const oEmptyWeeks = {};
            for (let i = 1; i <= 54; i++) { oEmptyWeeks["W" + i] = 0; }

            // Returns the hardcoded UI hierarchy (Demand, Supply, Inventory)
            return [
                {
                    Category: "DEMAND", MRPElement: " ", BackendCategory: "1", BackendMRPElement: "XX", ...oEmptyWeeks,
                    nodes: [
                        { Category: "", MRPElement: "Planned Independent Req.", BackendCategory: "1", BackendMRPElement: "IndReq", ...oEmptyWeeks, nodes: [] },
                        { Category: "", MRPElement: "Sales Order", BackendCategory: "1", BackendMRPElement: "SalesOrders", ...oEmptyWeeks, nodes: [] },
                        { Category: "", MRPElement: "Dependent Requirement", BackendCategory: "1", BackendMRPElement: "DepReq", ...oEmptyWeeks, nodes: [] }
                    ]
                },
                {
                    Category: "SUPPLY", MRPElement: " ", BackendCategory: "2", BackendMRPElement: "XX", ...oEmptyWeeks,
                    nodes: [
                        { Category: "", MRPElement: "PurRqs", BackendCategory: "2", BackendMRPElement: "PurRqs", ...oEmptyWeeks, nodes: [] },
                        { Category: "", MRPElement: "POitem", BackendCategory: "2", BackendMRPElement: "PurOrd", ...oEmptyWeeks, nodes: [] }
                    ]
                },
                {
                    Category: "INVENTORY", MRPElement: "", BackendCategory: "3", BackendMRPElement: "XX", ...oEmptyWeeks, nodes: [] 
                }
            ];
        },

        _mapODataToSkeleton(aFlatData) {
            // Grab a fresh, empty skeleton framework
            const aTree = this._getEmptySkeleton();

            aFlatData.forEach(oRow => {
                let sCat = "";
                if (oRow.Category) sCat = parseInt(oRow.Category, 10).toString(); // Converts "01" to "1"
                
                const sMrp = (oRow.MRPElement || "").trim();
                const sPlant = (oRow.Plant || "").trim(); 
                const sVer = (oRow.ProdVersion || "").trim(); 

                if (!sPlant || sPlant === "") return; // Skip bad records

                aTree.forEach(oParent => {
                    // Rule 1: Inventory goes straight under the main INVENTORY header
                    if (oParent.Category === "INVENTORY" && sCat === "3") {
                        let oLeaf = oParent.nodes.find(leaf => leaf.Plant === sPlant && leaf.ProdVersion === sVer);
                        if (oLeaf) {
                            // Sum quantities into existing leaf
                            for (let i = 1; i <= 54; i++) {
                                let nIncoming = Number(oRow["W" + i]) || 0;
                                oLeaf["W" + i] = (Number(oLeaf["W" + i]) || 0) + nIncoming;
                            }
                        } else {
                            // Create new leaf
                            oLeaf = {
                                Category: "", MRPElement: "", ProdVersion: sVer, Material: oRow.Material,
                                Plant: sPlant, BackendCategory: sCat, BackendMRPElement: sMrp
                            };
                            for (let i = 1; i <= 54; i++) { oLeaf["W" + i] = Number(oRow["W" + i]) || 0; }
                            oParent.nodes.push(oLeaf); 
                        }
                    } 
                    // Rule 2: Demands and Supplies go one level deeper
                    else if (oParent.nodes && oParent.Category !== "INVENTORY") {
                        oParent.nodes.forEach(oChild => {
                            if (oChild.BackendCategory === sCat && 
                               (oChild.BackendMRPElement === sMrp || (sMrp === "1A" && oChild.BackendMRPElement === "IndReq"))) {
                                
                                if (!oChild.nodes) oChild.nodes = [];
                                let oLeaf = oChild.nodes.find(leaf => leaf.Plant === sPlant && leaf.ProdVersion === sVer);

                                if (oLeaf) {
                                    for (let i = 1; i <= 54; i++) {
                                        let nIncoming = Number(oRow["W" + i]) || 0;
                                        oLeaf["W" + i] = (Number(oLeaf["W" + i]) || 0) + nIncoming;
                                    }
                                } else {
                                    oLeaf = {
                                        Category: "", MRPElement: "", ProdVersion: sVer, Material: oRow.Material,
                                        Plant: sPlant, BackendCategory: sCat, BackendMRPElement: sMrp
                                    };
                                    for (let i = 1; i <= 54; i++) { oLeaf["W" + i] = Number(oRow["W" + i]) || 0; }
                                    oChild.nodes.push(oLeaf);
                                }
                            }
                        });
                    }
                });
            });

            // Sort the generated leaf nodes alphabetically by Plant, then by Production Version
            aTree.forEach(p => {
                if (p.nodes) p.nodes.forEach(c => {
                    if (c.nodes) {
                        c.nodes.sort((a, b) => {
                            let plantCmp = a.Plant.localeCompare(b.Plant);
                            if (plantCmp !== 0) return plantCmp;
                            return a.ProdVersion.localeCompare(b.ProdVersion, undefined, { numeric: true });
                        });
                    }
                });
            });

            // Roll up all the numbers so the parent headers show totals
            this._recalculateEntireTree(aTree);
            return aTree;
        },

        _recalculateEntireTree(aTree) {
            // Loops from the bottom up. Adds leaf values to sub-headers, then sub-headers to headers.
            aTree.forEach(oTop => {
                if (oTop.Category === "DEMAND" || oTop.Category === "SUPPLY") {
                    if (oTop.nodes) {
                        oTop.nodes.forEach(oMid => {
                            if (oMid.nodes && oMid.nodes.length > 0) {
                                for (let i = 1; i <= 54; i++) {
                                    oMid["W" + i] = oMid.nodes.reduce((sum, leaf) => sum + (Number(leaf["W" + i]) || 0), 0);
                                }
                            }
                        });
                        for (let i = 1; i <= 54; i++) {
                            oTop["W" + i] = oTop.nodes.reduce((sum, mid) => sum + (Number(mid["W" + i]) || 0), 0);
                        }
                    }
                } 
                else if (oTop.Category === "INVENTORY") {
                    if (oTop.nodes && oTop.nodes.length > 0) {
                        for (let i = 1; i <= 54; i++) {
                            oTop["W" + i] = oTop.nodes.reduce((sum, leaf) => sum + (Number(leaf["W" + i]) || 0), 0);
                        }
                    }
                }
            });
        },

        // =========================================================
        // 4. SEARCH, FILTERS & VALUE HELPS
        // =========================================================
        _buildTokenFilters(sField, aTokens) {
            // Converts UI tokens/ranges into valid OData filters
            if (!aTokens || aTokens.length === 0) return null;
            const aFilters = aTokens.map(t => {
                const oRange = t.data("range");
                if (oRange) {
                    let sVal1 = oRange.value1;
                    if (typeof sVal1 === "string" && sVal1.startsWith("=")) sVal1 = sVal1.substring(1);
                    return new Filter(sField, oRange.operation || FilterOperator.EQ, sVal1, oRange.value2);
                }
                let sKey = t.getKey();
                if (typeof sKey === "string" && sKey.startsWith("=")) sKey = sKey.substring(1);
                return new Filter(sField, FilterOperator.EQ, sKey);
            });
            return new Filter({ filters: aFilters, and: false });
        },

        onMaterialVH(oEvent) { this._openAdvancedValueHelp(oEvent.getSource(), "Material", "Define Material Ranges"); },
        onPlantVH(oEvent) { this._openAdvancedValueHelp(oEvent.getSource(), "Plant", "Define Plant Ranges"); },
        onVendorVH(oEvent) { this._openAdvancedValueHelp(oEvent.getSource(), "Vendor", "Define Vendor Ranges"); },

        _openAdvancedValueHelp(oInput, sField, sTitle) {
            const oValueHelpDialog = new ValueHelpDialog({
                title: sTitle, supportMultiselect: true, supportRanges: true, supportRangesOnly: true, 
                key: sField, descriptionKey: sField,
                ok: function(oControlEvent) {
                    oInput.setTokens(oControlEvent.getParameter("tokens")); oValueHelpDialog.close();
                },
                cancel: function() { oValueHelpDialog.close(); },
                afterClose: function() { oValueHelpDialog.destroy(); }
            });

            const aRangeKeyFields = [{ label: sField, key: sField, type: "string", typeInstance: new TypeString({}, {maxLength: 40}) }];
            oValueHelpDialog.setRangeKeyFields(aRangeKeyFields);
            oValueHelpDialog.setTokens(oInput.getTokens());
            this.getView().addDependent(oValueHelpDialog);
            oValueHelpDialog.open();
        },

        onSearch() {
            // Triggered when user clicks "Go". Gathers filters and triggers OData read.
            const oODataModel = this.getOwnerComponent().getModel();
            const aMatTokens = this.byId("inpMaterial").getTokens();
            const aPlantTokens = this.byId("inpPlant").getTokens();
            const aVendorTokens = this.byId("inpVendor").getTokens();
            const oDR = this.byId("inpDateRange");
            const sPer = this.byId("inpPeriod").getSelectedKey(); // W, M, or Q

            // Guard rails: Prevent search if essential fields are empty
            if (!oDR.getDateValue() || aPlantTokens.length === 0 || aMatTokens.length === 0) {
                return MessageBox.error("Mandatory fields missing: Plant, Material, and Horizon.");
            }

            const dStartDate = oDR.getDateValue();
            const dEndDate = oDR.getSecondDateValue();

            // 1. Generate the dynamic column headers mathematically (W/M/Q)
            this.onGenerateColumns(this._generateTimeBuckets(dStartDate, dEndDate, sPer));

            // 2. Build the exact Filters to send to SAP Gateway
            const aFilters = [];
            const oMatFilter = this._buildTokenFilters("Material", aMatTokens);
            if (oMatFilter) aFilters.push(oMatFilter);

            const oPlantFilter = this._buildTokenFilters("Plant", aPlantTokens);
            if (oPlantFilter) aFilters.push(oPlantFilter);
            
            const oVendorFilter = this._buildTokenFilters("Vendor", aVendorTokens);
            if (oVendorFilter) aFilters.push(oVendorFilter);

            // Ensure timezone offsets don't shift the date sent to SAP
            const dStartFilter = new Date(Date.UTC(dStartDate.getFullYear(), dStartDate.getMonth(), dStartDate.getDate()));
            const dEndFilter = new Date(Date.UTC(dEndDate.getFullYear(), dEndDate.getMonth(), dEndDate.getDate(), 23, 59, 59));

            aFilters.push(new Filter("AvailDate", FilterOperator.BT, dStartFilter, dEndFilter));
            aFilters.push(new Filter("Period", FilterOperator.EQ, sPer));

            // 3. Fire the Request!
            this.getView().setBusy(true);
            oODataModel.read("/FlavorPlan", {
                filters: aFilters,
                urlParameters: { "$top": 5000 }, // Ensure we grab a large chunk of records
                success: oData => {
                    this.getView().setBusy(false);
                    
                    // Save raw data so we can use it later for the Document popovers
                    this.getView().getModel("localModel").setProperty("/RawData", oData.results);
                    
                    // Route data through the mapper to build the tree hierarchy
                    const aResult = this._mapODataToSkeleton(oData.results);
                    this.getView().getModel().setProperty("/mrpData", aResult);
                    
                    // Save an exact clone to backup model so we can calculate Deltas later
                    this._oBackupModel.setProperty("/mrpData", JSON.parse(JSON.stringify(aResult)));
                    
                    // Open the tree table slightly for better UX
                    this.byId("idMrpTreeTable").expandToLevel(1);
                    MessageToast.show("Data loaded successfully.");
                },
                error: () => { this.getView().setBusy(false); MessageBox.error("Backend Error."); }
            });
        },

        _generateTimeBuckets(dStart, dEnd, sPeriod) {
            // Calculates 54 specific dates based on user's start date and period selection
            const aBuckets = [];
            let dCur = new Date(dStart.getTime());
            const oFmtWk = DateFormat.getDateInstance({pattern: "MMM d, yyyy"});
            const oFmtMon = DateFormat.getDateInstance({pattern: "MMMM yyyy"});
            let iIdx = 1;

            while (dCur <= dEnd && iIdx <= 54) {
                let sLab = (sPeriod === "W") ? oFmtWk.format(dCur) : oFmtMon.format(dCur);
                if (sPeriod === "Q") sLab = "Q" + (Math.floor(dCur.getMonth() / 3) + 1) + " " + dCur.getFullYear();
                
                let dBucketEnd = new Date(dCur.getTime());
                if (sPeriod === "W") { dBucketEnd.setDate(dBucketEnd.getDate() + 6); } 
                else if (sPeriod === "M") { dBucketEnd.setMonth(dBucketEnd.getMonth() + 1); dBucketEnd.setDate(0); } 
                else { dBucketEnd.setMonth(dBucketEnd.getMonth() + 3); dBucketEnd.setDate(0); }

                // Store start date, end date, and UI label for each bucket
                aBuckets.push({ 
                    key: "W" + iIdx, 
                    label: sLab,
                    startDate: new Date(dCur.getTime()),
                    endDate: dBucketEnd 
                });
                
                if (sPeriod === "W") dCur.setDate(dCur.getDate() + 7);
                else if (sPeriod === "M") dCur.setMonth(dCur.getMonth() + 1);
                else dCur.setMonth(dCur.getMonth() + 3);
                iIdx++;
            }
            this.getView().getModel("localModel").setProperty("/TimeBuckets", aBuckets);
            return aBuckets;
        },

        onGenerateColumns(aBuckets) {
            // Destroys old date columns and builds 54 new ones dynamically
            const oTable = this.byId("idMrpTreeTable");
            const aCols = oTable.getColumns();
            // Columns 0-3 are static (Category, MRP Element, etc.). Destroy everything from 4 onwards.
            for (let i = aCols.length - 1; i >= 4; i--) oTable.removeColumn(aCols[i]).destroy();

            // Formatting: 3 decimal places
            const oInputDecimalType = new TypeFloat({ minFractionDigits: 3, maxFractionDigits: 3, groupingEnabled: false, parseEmptyValueToZero: true });
            const oDisplayDecimalType = new TypeFloat({ minFractionDigits: 3, maxFractionDigits: 3, groupingEnabled: true, parseEmptyValueToZero: true });

            aBuckets.forEach(oBuck => {
                
                // Creates the editable Input Box for leaf nodes (e.g. PurRqs)
                const oInp = new Input({
                    value: { path: oBuck.key, type: oInputDecimalType }, textAlign: "End",
                    visible: { 
                        parts: ['Category'], 
                        formatter: (category) => {
                            // Hide input boxes on parent header rows
                            return !(category === "INVENTORY" || category === "DEMAND" || category === "SUPPLY");
                        } 
                    },
                    editable: { 
                        parts: ['nodes', 'BackendCategory'], 
                        formatter: (nodes, category) => {
                            if (nodes && nodes.length > 0) return false; // Lock headers
                            if (category === "1") return false;          // Lock Demand
                            if (category === "3") return false;          // Lock Inventory
                            return true;                                 // Unlock Supply!
                        } 
                    },
                    change: this.onValueChange.bind(this)
                }).addCustomData(new CustomData({ key: "weekProp", value: oBuck.key }))
                  .addCustomData(new CustomData({ key: "columnLabel", value: oBuck.label }));

                oInp.addEventDelegate({ ondblclick: (e) => this.onCellDoubleClick(e.srcControl) });

                // Creates the bold, non-editable text for parent header rows
                const oBoldTotals = new ObjectNumber({
                    number: { path: oBuck.key, type: oDisplayDecimalType }, emphasized: true, textAlign: "End",
                    visible: { 
                        parts: ['Category'], 
                        formatter: (category) => { return (category === "DEMAND" || category === "SUPPLY"); } 
                    }
                });

                // Creates colored text for Inventory (Red if negative, Green if positive)
                const oInventoryText = new ObjectNumber({
                    number: { path: oBuck.key, type: oDisplayDecimalType }, emphasized: true, textAlign: "End",
                    visible: { path: 'Category', formatter: c => c === 'INVENTORY' },
                    state: { path: oBuck.key, formatter: v => Number(v) < 0 ? "Error" : "Success" }
                });

                // Stick all three into an HBox. They use formatters to ensure only one is visible per row!
                oTable.addColumn(new Column({
                    label: new Label({ text: oBuck.label, design: "Bold", textAlign: "End", width: "100%" }),
                    width: "150px", autoResizable: true, hAlign: "End",
                    template: new HBox({ justifyContent: "End", items: [ oInp, oBoldTotals, oInventoryText ]})
                }));
            });
        },

        // =========================================================
        // 5. GRID INTERACTION (Editing & Viewing data)
        // =========================================================
        onValueChange(oEvent) {
            // Triggered whenever a user types a new number and presses Enter/Tab
            const oInp = oEvent.getSource();
            const oMod = this.getView().getModel();
            const sWeek = oInp.data("weekProp"); // e.g., 'W5'
            let sPath = oInp.getBindingContext().getPath();
            const oRow = oMod.getProperty(sPath);
            let nVal = Number(oInp.getValue()) || 0; 

            // Grab the original value from our Backup Model to calculate the Delta
            let nCellOldQty = Number(this._oBackupModel.getProperty(sPath + "/" + sWeek)) || 0;

            const aRawData = this.getView().getModel("localModel").getProperty("/RawData");
            const aBuckets = this.getView().getModel("localModel").getProperty("/TimeBuckets");

            // Look up exact cell dates from the dynamic buckets
            let oStartDate = null, oEndDate = null;
            if (aBuckets) {
                const oBucketDef = aBuckets.find(b => b.key === sWeek);
                if (oBucketDef) { oStartDate = oBucketDef.startDate; oEndDate = oBucketDef.endDate; }
            }

            let sMat = oRow.Material || (this.byId("inpMaterial").getTokens()[0] ? this.byId("inpMaterial").getTokens()[0].getKey() : "");
            let sPlnt = oRow.Plant || (this.byId("inpPlant").getTokens()[0] ? this.byId("inpPlant").getTokens()[0].getKey() : "");

            // Cross-reference the clicked cell with the raw backend data to find individual PRs/POs
            let aMatches = [];
            if (aRawData) {
                aMatches = aRawData.filter(r => 
                    (r.Material || "").trim() === (oRow.Material || "").trim() && 
                    (r.Plant || "").trim() === (oRow.Plant || "").trim() && 
                    (r.ProdVersion || "").trim() === (oRow.ProdVersion || "").trim() && 
                    (r.MRPElement || "").trim() === (oRow.BackendMRPElement || "").trim() &&
                    Number(r[sWeek]) > 0 
                );
            }

            // Push changes to the master ChangeLog array (this becomes the OData batch payload)
            const fnPushToLog = (oContext) => {
                const idx = this._aChangeLog.findIndex(c => 
                    c.Material === oContext.Material && c.Plant === oContext.Plant && c.ProdVersion === oContext.ProdVersion && 
                    c.MRPElement === oContext.MRPElement && c.PeriodBucket === oContext.PeriodBucket && 
                    c.PurchaseReq === oContext.PurchaseReq && c.LineItem === oContext.LineItem
                );
                if (idx !== -1) { this._aChangeLog[idx] = oContext; } else { this._aChangeLog.push(oContext); }
            };

            // If no underlying PRs exist, record it as a new line
            if (aMatches.length === 0) {
                fnPushToLog({ 
                    Material: sMat, Plant: sPlnt, Category: oRow.BackendCategory || "1", MRPElement: oRow.BackendMRPElement || "IndReq", 
                    ProdVersion: oRow.ProdVersion || " ", PeriodBucket: sWeek, NewQuantity: nVal, OldQuantity: nCellOldQty, 
                    PurchaseReq: "", LineItem: "", AvailDate: oStartDate, WkEndDate: oEndDate
                });
            } else {
                // If PRs exist, attach their document numbers to the payload so the backend knows which one to adjust
                aMatches.forEach(oMatch => {
                    let nItemOldQty = Number(oMatch[sWeek]) || 0;
                    fnPushToLog({ 
                        Material: sMat, Plant: sPlnt, Category: oRow.BackendCategory, MRPElement: oRow.BackendMRPElement, 
                        ProdVersion: oRow.ProdVersion, PeriodBucket: sWeek, NewQuantity: nVal, OldQuantity: nItemOldQty, 
                        PurchaseReq: oMatch.PurchaseReq || "", LineItem: oMatch.LineItem || "", 
                        AvailDate: oStartDate, WkEndDate: oEndDate
                    });
                });
            }

            // Immediately roll-up the new number so parent headers reflect the change without requiring a backend round-trip
            while (sPath.includes("/nodes/")) {
                const aParts = sPath.split("/"); aParts.pop(); aParts.pop(); sPath = aParts.join("/");
                const oPar = oMod.getProperty(sPath);
                if (oPar.nodes) {
                    const total = oPar.nodes.reduce((s, c) => s + (Number(c[sWeek]) || 0), 0);
                    oMod.setProperty(sPath + "/" + sWeek, total);
                }
            }
            this._recalculateEntireTree(oMod.getProperty("/mrpData"));
        },

        onCellDoubleClick(oInp) {
            // Triggered when user double-clicks an input box
            const oCtx = oInp.getBindingContext();
            const oRow = oCtx.getProperty();
            const sWeek = oInp.data("weekProp");

            // If it's a Purchase Req or Purchase Order, open the advanced Table Popover
            if (oRow.BackendMRPElement === "PurRqs" || oRow.BackendMRPElement === "PurOrd" || oRow.BackendMRPElement === "BB") {
                this._showDocumentDetails(oInp, oRow, sWeek);
            } else {
                // Otherwise open a simple detail view
                this._oCurrentEditContext = {
                    category: oRow.Category || "Supply", element: oRow.MRPElement || "PR",
                    prodVersion: oRow.ProdVersion || "None", periodLabel: oInp.data("columnLabel"), value: oInp.getValue()
                };
                this._openDetailFragment();
            }
        },

        _openDetailFragment() {
            if (!this._oDetailDialog) {
                Fragment.load({ id: this.getView().getId(), name: "flavournamespace.flavourmodule.view.DetailDialog", controller: this })
                    .then(oD => { this._oDetailDialog = oD; this.getView().addDependent(oD); this._bindFrag(); oD.open(); });
            } else { this._bindFrag(); this._oDetailDialog.open(); }
        },

        _bindFrag() {
            const d = this._oCurrentEditContext;
            this.byId("fragCategory").setText(d.category); this.byId("fragElement").setText(d.element);
            this.byId("fragProdVer").setText(d.prodVersion); this.byId("fragWeek").setText(d.periodLabel);
            this.byId("fragQty").setNumber(d.value);
        },

        _showDocumentDetails: function (oInput, oRowData, sWeek) {
            // Looks into the Raw Backend data, finds all documents making up the cell sum, and formats them for the Popover Table
            let aRawBackendData = this.getView().getModel("localModel").getProperty("/RawData");
            if (!aRawBackendData) return;

            let sConfig = {};
            let aMappedItems = [];

            if (oRowData.BackendMRPElement === "PurRqs") {
                sConfig = { Title: "Purchase Requisition Details", Col1Label: "Prod Ver Txt", DocColLabel: "Purchase Req" };
                aMappedItems = aRawBackendData.filter(row => 
                    row.Material === oRowData.Material && row.ProdVersion === oRowData.ProdVersion && 
                    row.MRPElement === "PurRqs" && Number(row[sWeek]) > 0
                ).map(row => {
                    let aParts = (row.ProdVersion || "").split(" / ");
                    return {
                        Category: "Supply", MRPElementText: "Purchase Req", ProdVersion: aParts[0] ? aParts[0].trim() : "", 
                        Col1Value: aParts[1] ? aParts.slice(1).join(" / ").trim() : (row.ProdVerText || ""), 
                        DocNumber: row.PurchaseReq, DocItem: row.LineItem, Material: row.Material, 
                        Plant: oRowData.Plant, BackendCategory: oRowData.BackendCategory, BackendMRPElement: "PurRqs", 
                        Description: row.MaterialDesc, Quantity: row.ReqQuantity, AvailDate: row.AvailDate
                    };
                });
            } else if (oRowData.BackendMRPElement === "PurOrd") {  
                sConfig = { Title: "Purchase Order Details", Col1Label: "Prod Ver Txt", DocColLabel: "Purchase Order" };
                aMappedItems = aRawBackendData.filter(row => row.Material === oRowData.Material && row.ProdVersion === oRowData.ProdVersion && row.MRPElement === "PurOrd" && Number(row[sWeek]) > 0).map(row => {
                    let aParts = (row.ProdVersion || "").split(" / ");
                    return { Category: "Supply", MRPElementText: "Purchase Order", ProdVersion: aParts[0] ? aParts[0].trim() : "", Col1Value: aParts[1] ? aParts.slice(1).join(" / ").trim() : (row.ProdVerText || ""), DocNumber: row.PurchaseReq, DocItem: row.LineItem, Material: row.Material, Plant: oRowData.Plant, BackendCategory: oRowData.BackendCategory, BackendMRPElement: "PurOrd", Description: row.MaterialDesc, Quantity: row.ReqQuantity, AvailDate: row.AvailDate };
                });
            }

            this.getView().getModel("localModel").setProperty("/PopoverConfig", sConfig);
            this.getView().getModel("localModel").setProperty("/SelectedItems", aMappedItems);

            // Lazy load the fragment once
            if (!this._pDocPopover) {
                this._pDocPopover = sap.ui.core.Fragment.load({ id: this.getView().getId(), name: "flavournamespace.flavourmodule.view.DocumentDetails", controller: this }).then(function(oPopover) {
                    this.getView().addDependent(oPopover); return oPopover;
                }.bind(this));
            }
            // Open next to the exact cell they clicked
            this._pDocPopover.then(function(oPopover) { 
                const oTable = this.byId("idDocDetailsTable");
                if (oTable) oTable.removeSelections(true); 
                oPopover.openBy(oInput); 
            }.bind(this));
        },

        // =========================================================
        // 6. BACKEND ODATA COMMUNICATION (Saves & Conversions)
        // =========================================================
        onConvertPrToPo: function () {
            // Triggered from inside the DocumentDetails Popover when user highlights PRs and clicks Convert
            const oTable = this.byId("idDocDetailsTable");
            const aSelectedContexts = oTable.getSelectedContexts();

            if (aSelectedContexts.length === 0) return MessageBox.warning("Please select at least one document to convert.");

            let sVendor = this.byId("inpVendor").getTokens()[0] ? this.byId("inpVendor").getTokens()[0].getKey() : "";
            if (!sVendor) return MessageBox.warning("A Vendor is required to convert a PR to a PO. Please add a Vendor to the top filter bar.");

            const aSelectedPRs = aSelectedContexts.map(oContext => oContext.getObject());
            const oOData = this.getOwnerComponent().getModel();
            
            // Set Batch mode so we don't bombard the server with 20 individual calls
            oOData.setUseBatch(true);
            oOData.setDeferredGroups(["convertGrp"]);

            const fnToUTC = (d) => {
                if (!d) return null;
                return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
            };

            // Grab the GLOBAL dates and PERIOD from the UI DatePicker/Dropdown
            const oDR = this.byId("inpDateRange");
            const dGlobalStart = oDR.getDateValue();
            const dGlobalEnd = oDR.getSecondDateValue();
            const sPer = this.byId("inpPeriod").getSelectedKey();

            // Build payload for each selected row
            aSelectedPRs.forEach(pr => {
                let sFormattedDate = pr.AvailDate ? sap.ui.core.format.DateFormat.getDateInstance({pattern: "yyyyMMdd"}).format(pr.AvailDate) : "";
                
                const payload = { 
                    Material: pr.Material, Plant: pr.Plant, Category: pr.BackendCategory || "2", MRPElement: pr.BackendMRPElement, 
                    ProdVersion: pr.ProdVersion ? pr.ProdVersion : " ", PurchaseReq: pr.DocNumber, LineItem: pr.DocItem, 
                    ReqQuantity: pr.Quantity.toString(), Vendor: sVendor, 
                    
                    // 1. EXACT CELL DATES: This feeds the Lead's BETWEEN logic perfectly (e.g. April 1st)
                    AvailDate: fnToUTC(pr.AvailDate), 
                    
                    // 2. GLOBAL DATES: This feeds the Lead's Calendar Builder perfectly (e.g. Jan 14th to Dec 31st)
                    GlobalStart: fnToUTC(dGlobalStart),
                    GlobalEnd: fnToUTC(dGlobalEnd),
                    
                    // 3. PERIOD FLAG: Safely tells ABAP whether it is W, M, or Q without math
                    Period: sPer,
                    
                    WeekNo: sFormattedDate,  
                    IsConvert: true // Special flag telling ABAP to convert rather than update quantity
                };
                oOData.create("/FlavorPlan", payload, { groupId: "convertGrp" });
            });

            this.getView().setBusy(true);
            
            // Submit the entire Batch
            oOData.submitChanges({
                groupId: "convertGrp",
                success: (oData) => { 
                    this.getView().setBusy(false); 
                    
                    // Pulls raw BAPI return messages out of the OData payload
                    let aMsgs = this._extractBatchErrors(oData, aSelectedPRs);
                    
                    // Determine if the backend passed any red errors back
                    let bHasError = aMsgs.some(m => m.type === "error" || m.type === "E" || m.type === "error");
                    
                    // Feed the raw messages to our emoji formatter
                    this._showAllMessages(aMsgs, "Conversion Operation", () => {
                        const oTableToClear = this.byId("idDocDetailsTable");
                        if (oTableToClear) oTableToClear.removeSelections(true);
                        
                        this.onCloseDocFragment(); 
                        this._aChangeLog = []; 
                        
                        // NEW LOGIC: Clear tokens and grid only if successful!
                        if (!bHasError) {
                            this.byId("inpMaterial").removeAllTokens();
                            this.byId("inpPlant").removeAllTokens();
                            this.byId("inpVendor").removeAllTokens();
                            this.byId("inpDateRange").setValue("");
                            
                            const aEmptyTree = this._getEmptySkeleton();
                            this.getView().getModel().setProperty("/mrpData", aEmptyTree);
                            this._oBackupModel.setProperty("/mrpData", JSON.parse(JSON.stringify(aEmptyTree)));
                        } else {
                            // If errors, keep their filters and just refresh the grid
                            this.getView().getModel().refresh(); 
                            this.onSearch();
                        }
                    });
                },
                error: (oError) => { 
                    this.getView().setBusy(false); 
                    let aMsgs = this._parseODataError(oError);
                    this._showAllMessages(aMsgs, "Conversion Failed");
                }
            });
        },

        onSave() {
            // Triggered by the main Save button to process manual cell edits
            if (this._aChangeLog.length === 0) return MessageBox.information("No changes to save.");
            
            const oOData = this.getOwnerComponent().getModel();
            oOData.setUseBatch(true);
            oOData.setDeferredGroups(["grp"]);

            const fnToUTC = (d) => {
                if (!d) return null;
                return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
            };

            // Grab the GLOBAL dates and PERIOD from the UI DatePicker/Dropdown
            const oDR = this.byId("inpDateRange");
            const dGlobalStart = oDR.getDateValue();
            const dGlobalEnd = oDR.getSecondDateValue();
            const sPer = this.byId("inpPeriod").getSelectedKey();

            // Build Batch Payload
            this._aChangeLog.forEach(c => {
                let sWeekNum = c.PeriodBucket.replace("W", "");
                if (sWeekNum.length === 1) sWeekNum = "0" + sWeekNum; // Force 'W5' into '05'
                let sFormattedColNo = "COL" + sWeekNum;               // ABAP needs 'COL05'

                const payload = { 
                    Material: c.Material, Plant: c.Plant, Category: c.Category, MRPElement: c.MRPElement, 
                    ProdVersion: c.ProdVersion ? c.ProdVersion : " ", PurchaseReq: c.PurchaseReq, LineItem: c.LineItem, 
                    
                    // 1. EXACT CELL DATES: This feeds the Lead's BETWEEN logic perfectly (e.g. April 1st)
                    AvailDate: fnToUTC(c.AvailDate), 
                    WkEndDate: fnToUTC(c.WkEndDate),

                    // 2. GLOBAL DATES: This feeds the Lead's Calendar Builder perfectly (e.g. Jan 14th to Dec 31st)
                    GlobalStart: fnToUTC(dGlobalStart),
                    GlobalEnd: fnToUTC(dGlobalEnd),
                    
                    // 3. PERIOD FLAG: Safely tells ABAP whether it is W, M, or Q without math
                    Period: sPer,
                    
                    WeekNo: sFormattedColNo, WeekQty: c.NewQuantity.toString(), ReqQuantity: c.OldQuantity.toString()
                };
                
                payload[c.PeriodBucket] = c.NewQuantity.toString(); 
                oOData.create("/FlavorPlan", payload, { groupId: "grp" });
            });

            this.getView().setBusy(true);
            
            // Fire the Batch
            oOData.submitChanges({
                groupId: "grp",
                success: (oData) => { 
                    this.getView().setBusy(false); 
                    
                    // Extract BAPI messages from backend ABAP class (zcl_ricef13_mm_flav_save_logic)
                    let aMsgs = this._extractBatchErrors(oData, this._aChangeLog);
                    
                    // Determine if the backend passed any red errors back
                    let bHasError = aMsgs.some(m => m.type === "error" || m.type === "E" || m.type === "error");
                    
                    // Display success/warnings beautifully
                    this._showAllMessages(aMsgs, "Save Operation", () => {
                        this._aChangeLog = []; 
                        
                        // NEW LOGIC: Clear tokens and grid only if successful!
                        if (!bHasError) {
                            this.byId("inpMaterial").removeAllTokens();
                            this.byId("inpPlant").removeAllTokens();
                            this.byId("inpVendor").removeAllTokens();
                            this.byId("inpDateRange").setValue("");
                            
                            const aEmptyTree = this._getEmptySkeleton();
                            this.getView().getModel().setProperty("/mrpData", aEmptyTree);
                            this._oBackupModel.setProperty("/mrpData", JSON.parse(JSON.stringify(aEmptyTree)));
                        } else {
                            // If errors, keep their filters and just refresh the grid
                            this.getView().getModel().refresh(); 
                            this.onSearch(); 
                        }
                    });
                },
                error: (oError) => { 
                    this.getView().setBusy(false); 
                    let aMsgs = this._parseODataError(oError);
                    this._showAllMessages(aMsgs, "Save Failed");
                }
            });
        },

        // =========================================================
        // 7. BATCH ERROR PARSERS & UI FORMATTERS
        // =========================================================
        _showAllMessages: function(aMsgs, sTitle, fnCallback) {
            // Central UI method to display backend BAPI messages using Emojis

            // Fallback if backend returned no specific messages
            if (!aMsgs || aMsgs.length === 0) {
                MessageToast.show(sTitle + " completed successfully.");
                if (fnCallback) fnCallback();
                return;
            }

            let bHasError = aMsgs.some(m => m.type === "error" || m.type === "E" || m.type === "error");

            // Deduplicate (SAP BAPIs notorious for sending the same warning 4 times in a row)
            const aUniqueMsgs = [...new Map(aMsgs.map(m => [m.message, m])).values()];

            // Prefix with nice emojis
            let sMessageText = aUniqueMsgs.map(m => {
                let type = (m.type || "").toLowerCase();
                let sPrefix = "ℹ️ "; 
                if (type === "error" || type === "e") sPrefix = "❌ ";
                else if (type === "warning" || type === "w") sPrefix = "⚠️ ";
                else if (type === "success" || type === "s") sPrefix = "✅ ";
                return sPrefix + m.message;
            }).join("\n\n");

            // Show Error Box or Info Box, then execute the callback (e.g. onSearch()) on close
            if (bHasError) {
                MessageBox.error(sTitle + " completed with errors:\n\n" + sMessageText, { onClose: fnCallback });
            } else {
                MessageBox.information(sTitle + " Results:\n\n" + sMessageText, { onClose: fnCallback });
            }
        },

        _extractBatchErrors: function(oData, aContextArray) {
            // Digs deep into the OData V2 response structure to pull out the hidden 'sap-message' headers
            let aMsgs = [];
            let iChangeIndex = 0; 

            if (oData && oData.__batchResponses) {
                oData.__batchResponses.forEach(res => {
                    
                    // 1. Check for standard HTTP errors (e.g. 500 dumps)
                    if (res.response && res.response.statusCode >= 400) {
                        try {
                            let oBody = JSON.parse(res.response.body);
                            if (oBody.error && oBody.error.innererror && oBody.error.innererror.errordetails) {
                                oBody.error.innererror.errordetails.forEach(err => {
                                    if (err.code !== "/IWBEP/CX_MGW_BUSI_EXCEPTION" && err.code !== "") {
                                        aMsgs.push({ type: err.severity, message: err.message });
                                    }
                                });
                            } else if (oBody.error && oBody.error.message) {
                                aMsgs.push({ type: "error", message: oBody.error.message.value });
                            }
                        } catch (e) { aMsgs.push({ type: "error", message: res.message || "Unknown batch error." }); }
                    }
                    
                    // 2. Check header for parent level messages
                    if (res.headers && res.headers["sap-message"]) {
                        this._parseSapMessageHeader(res.headers["sap-message"], aMsgs, "");
                    }

                    // 3. Dig into each individual changeset (row update) inside the batch
                    if (res.__changeResponses) {
                        res.__changeResponses.forEach(changeRes => {
                            let oContext = (aContextArray && aContextArray[iChangeIndex]) ? aContextArray[iChangeIndex] : {};
                            let sPrefix = "";
                            
                            // Try to map the message back to the specific material/PR so user knows what row failed
                            if (oContext.DocNumber) sPrefix = `[PR ${oContext.DocNumber}]: `;
                            else if (oContext.PurchaseReq) sPrefix = `[PR ${oContext.PurchaseReq}]: `;
                            else if (oContext.Material) sPrefix = `[Mat ${oContext.Material} - ${oContext.PeriodBucket || oContext.Plant}]: `;

                            if (changeRes.headers && changeRes.headers["sap-message"]) {
                                this._parseSapMessageHeader(changeRes.headers["sap-message"], aMsgs, sPrefix);
                            }
                            iChangeIndex++;
                        });
                    }
                });
            }
            return aMsgs;
        },

        _parseSapMessageHeader: function(sSapMessage, aMsgs, sPrefix) {
            // Parses the stringified JSON header SAP Gateway uses to pass BAPIRET2 tables
            try {
                let oSapMsg = JSON.parse(sSapMessage);
                sPrefix = sPrefix || "";
                aMsgs.push({ type: oSapMsg.severity, message: sPrefix + oSapMsg.message });
                if (oSapMsg.details) {
                    oSapMsg.details.forEach(d => {
                        aMsgs.push({ type: d.severity, message: sPrefix + d.message });
                    });
                }
            } catch(e) {}
        },

        _parseODataError: function (oError) {
            // Standard catch block for single (non-batch) errors
            let aMsgs = [];
            try {
                let oResponse = JSON.parse(oError.responseText);
                if (oResponse.error && oResponse.error.innererror && oResponse.error.innererror.errordetails) {
                    oResponse.error.innererror.errordetails.forEach(err => {
                        if (err.code !== "/IWBEP/CX_MGW_BUSI_EXCEPTION" && err.code !== "") {
                            aMsgs.push({ type: err.severity, message: err.message });
                        }
                    });
                } else if (oResponse.error && oResponse.error.message) {
                    aMsgs.push({ type: "error", message: oResponse.error.message.value });
                }
            } catch (e) { aMsgs.push({ type: "error", message: oError.message || "Unknown error." }); }
            return aMsgs;
        },
        
        onRefresh() { this.onSearch(); },

        onToggleTheme(oEvent) {
            const oButton = oEvent.getSource();
            const oTheming = sap.ui.require("sap/ui/core/Theming");
            
            const sCurrentTheme = oTheming ? oTheming.getTheme() : sap.ui.getCore().getConfiguration().getTheme();
            const isDark = sCurrentTheme.includes("dark");

            const newTheme = isDark ? "sap_horizon" : "sap_horizon_dark";

            if (oTheming) {
                oTheming.setTheme(newTheme);
            } else {
                sap.ui.getCore().applyTheme(newTheme);
            }

            oButton.setIcon(isDark ? "sap-icon://eclipse" : "sap-icon://lightbulb");
        },

        onCloseFragment() { if (this._oDetailDialog) this._oDetailDialog.close(); },
        onCloseDocFragment: function () { if (this._pDocPopover) this._pDocPopover.then(function(oPopover){ oPopover.close(); }); }

    });
});