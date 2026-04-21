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
            window.myDebug = this; 

            const oEmptyModel = new JSONModel({ mrpData: this._getEmptySkeleton() });
            this.getView().setModel(oEmptyModel);

            this._oBackupModel = new JSONModel({ mrpData: this._getEmptySkeleton() });

            const oLocalModel = new JSONModel({
                RawData: [],        
                PopoverConfig: {},  
                SelectedItems: [],  
                TimeBuckets: [],
                SavedVariants: []   
            });
            this.getView().setModel(oLocalModel, "localModel");

            const oTreeTable = this.byId("idMrpTreeTable");
            if (oTreeTable) {
                oTreeTable.bindRows({
                    path: "/mrpData",
                    parameters: { arrayNames: ["nodes"] }
                });
            }

            this._aChangeLog = []; 

            const fnTokenValidator = args => {
                let sText = args.text.toUpperCase(); 
                let sKey = sText;
                if (sKey.startsWith("=")) { sKey = sKey.substring(1); } 
                return new Token({ key: sKey, text: sText });
            };

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

            this._loadVariants();
        },

        // =========================================================
        // 2. VARIANT MANAGEMENT (Saving UI State via Data Binding)
        // =========================================================
        _loadVariants() {
            const sData = localStorage.getItem("flavorVariants"); 
            this._aCustomVariants = sData ? JSON.parse(sData) : [];

            this.getView().getModel("localModel").setProperty("/SavedVariants", this._aCustomVariants);
            
            sap.ui.require(["sap/ui/comp/variants/VariantItem"], (VariantItem) => {
                const oVM = this.byId("idVariantManagement");
                
                if (oVM) {
                    if (!oVM.getBindingInfo("variantItems")) {
                        oVM.bindAggregation("variantItems", {
                            path: "localModel>/SavedVariants",
                            template: new VariantItem({
                                key: "{localModel>key}",
                                text: "{localModel>name}",
                                author: "Local User"
                            })
                        });
                    }

                    const sDef = localStorage.getItem("flavorDefVariant");
                    if (sDef) {
                        oVM.setDefaultVariantKey(sDef);
                        oVM.setInitialSelectionKey(sDef);
                        setTimeout(() => this._applyVariant(sDef), 300); 
                    }
                }
            });
        },

        onSaveVariant(oEvent) {
            const sName = oEvent.getParameter("name");
            const bOverwrite = oEvent.getParameter("overwrite");
            const bDefault = oEvent.getParameter("def");
            let sKey = oEvent.getParameter("key");

            const fnGetTokens = (id) => this.byId(id).getTokens().map(t => ({ key: t.getKey(), text: t.getText(), range: t.data("range") }));

            const oState = {
                material: fnGetTokens("inpMaterial"),
                plant: fnGetTokens("inpPlant"),
                vendor: fnGetTokens("inpVendor"),
                dateStart: this.byId("inpDateRange").getDateValue(),
                dateEnd: this.byId("inpDateRange").getSecondDateValue(),
                period: this.byId("inpPeriod").getSelectedKey()
            };

            if (bOverwrite) {
                const oVar = this._aCustomVariants.find(v => v.key === sKey);
                if (oVar) oVar.state = oState;
            } else {
                sKey = "var_" + Date.now(); 
                this._aCustomVariants.push({ key: sKey, name: sName, state: oState });
            }

            this.getView().getModel("localModel").setProperty("/SavedVariants", this._aCustomVariants);

            if (bDefault) {
                this.byId("idVariantManagement").setDefaultVariantKey(sKey);
                localStorage.setItem("flavorDefVariant", sKey);
            }

            localStorage.setItem("flavorVariants", JSON.stringify(this._aCustomVariants));
            MessageToast.show("Variant saved successfully.");
        },

        onSelectVariant(oEvent) {
            const sKey = oEvent.getParameter("key");
            this._applyVariant(sKey);
        },

        _applyVariant(sKey) {
            if (sKey === "*standard*") {
                this.byId("inpMaterial").removeAllTokens();
                this.byId("inpPlant").removeAllTokens();
                this.byId("inpVendor").removeAllTokens();
                this.byId("inpDateRange").setValue("");
                this.byId("inpPeriod").setSelectedKey("W");
                return;
            }

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
                this.onSearch(); 
            }
        },

        onManageVariant(oEvent) {
            const aDeleted = oEvent.getParameter("deleted") || [];
            const aRenamed = oEvent.getParameter("renamed") || [];
            const sDef = oEvent.getParameter("def");

            aDeleted.forEach(sDelKey => {
                this._aCustomVariants = this._aCustomVariants.filter(v => v.key !== sDelKey);
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

            this.getView().getModel("localModel").setProperty("/SavedVariants", this._aCustomVariants);
            localStorage.setItem("flavorVariants", JSON.stringify(this._aCustomVariants));
        },

        // =========================================================
        // 3. TREE TABLE SKELETON & HIGH-PERFORMANCE MAPPING
        // =========================================================
        _getEmptySkeleton() {
            const oEmptyWeeks = {};
            for (let i = 1; i <= 54; i++) { oEmptyWeeks["W" + i] = 0; }

            return [
                {
                    Category: "DEMAND", MRPElement: " ", BackendCategory: "1", BackendMRPElement: "XX", ...oEmptyWeeks,
                    nodes: [
                        { Category: "", MRPElement: "Planned Independent Req.", BackendCategory: "1", BackendMRPElement: "IndReq", ...oEmptyWeeks, nodes: [] },
                        { Category: "", MRPElement: "Sales Order", BackendCategory: "1", BackendMRPElement: "SalesOrders", ...oEmptyWeeks, nodes: [] },
                        { Category: "", MRPElement: "Dependent Requirement", BackendCategory: "1", BackendMRPElement: "DepReq", ...oEmptyWeeks, nodes: [] },
                        { Category: "", MRPElement: "Transfer Requirement Line", BackendCategory: "1", BackendMRPElement: "TransferRequirement", ...oEmptyWeeks, nodes: []}
                    ]
                },
                {
                    Category: "SUPPLY", MRPElement: " ", BackendCategory: "2", BackendMRPElement: "XX", ...oEmptyWeeks,
                    nodes: [
                        { Category: "", MRPElement: "PurRqs", BackendCategory: "2", BackendMRPElement: "PurRqs", ...oEmptyWeeks, nodes: [] },
                        { Category: "", MRPElement: "POitem", BackendCategory: "2", BackendMRPElement: "PurOrd", ...oEmptyWeeks, nodes: [] },
                        { Category: "", MRPElement: "STOs", BackendCategory: "2", BackendMRPElement: "STOs", ...oEmptyWeeks, nodes: [] }
                    ]
                },
                {
                    Category: "INVENTORY", MRPElement: "", BackendCategory: "3", BackendMRPElement: "XX", ...oEmptyWeeks, nodes: [] 
                }
            ];
        },

        _mapODataToSkeleton(aFlatData) {
            const aTree = this._getEmptySkeleton();
            const oLookupCache = {};

            aFlatData.forEach(oRow => {
                let sCat = "";
                if (oRow.Category) sCat = parseInt(oRow.Category, 10).toString(); 
                
                const sMrp = (oRow.MRPElement || "").trim();
                const sPlant = (oRow.Plant || "").trim(); 
                const sVer = (oRow.ProdVersion || "").trim(); 
                const sMat = oRow.Material;

                if (!sPlant || sPlant === "") return; 

                aTree.forEach(oParent => {
                    if (oParent.Category === "INVENTORY" && sCat === "3") {
                        
                        let sCacheKey = `INV_${sPlant}_${sVer}_${sMat}`;
                        let oLeaf = oLookupCache[sCacheKey];
                        
                        if (oLeaf) {
                            for (let i = 1; i <= 54; i++) {
                                oLeaf["W" + i] = Number(((Number(oLeaf["W" + i]) || 0) + (Number(oRow["W" + i]) || 0)).toFixed(3));
                            }
                        } else {
                            oLeaf = {
                                Category: "", MRPElement: "", ProdVersion: sVer, Material: sMat, 
                                Plant: sPlant, BackendCategory: sCat, BackendMRPElement: sMrp
                            };
                            for (let i = 1; i <= 54; i++) { 
                                oLeaf["W" + i] = Number((Number(oRow["W" + i]) || 0).toFixed(3)); 
                            }
                            oParent.nodes.push(oLeaf); 
                            oLookupCache[sCacheKey] = oLeaf; 
                        }
                    } 
                    else if (oParent.nodes && oParent.Category !== "INVENTORY") {
                        oParent.nodes.forEach(oChild => {
                            if (oChild.BackendCategory === sCat && 
                               (oChild.BackendMRPElement === sMrp || (sMrp === "1A" && oChild.BackendMRPElement === "IndReq"))) {
                                
                                if (!oChild.nodes) oChild.nodes = [];
                                
                                let sCacheKey = `${sCat}_${oChild.BackendMRPElement}_${sPlant}_${sVer}_${sMat}`;
                                let oLeaf = oLookupCache[sCacheKey];

                                if (oLeaf) {
                                    for (let i = 1; i <= 54; i++) {
                                        oLeaf["W" + i] = Number(((Number(oLeaf["W" + i]) || 0) + (Number(oRow["W" + i]) || 0)).toFixed(3));
                                    }
                                } else {
                                    oLeaf = {
                                        Category: "", MRPElement: "", ProdVersion: sVer, Material: sMat, 
                                        Plant: sPlant, BackendCategory: sCat, BackendMRPElement: sMrp
                                    };
                                    for (let i = 1; i <= 54; i++) { 
                                        oLeaf["W" + i] = Number((Number(oRow["W" + i]) || 0).toFixed(3)); 
                                    }
                                    oChild.nodes.push(oLeaf);
                                    oLookupCache[sCacheKey] = oLeaf; 
                                }
                            }
                        });
                    }
                });
            });

            aTree.forEach(p => {
                if (p.nodes) p.nodes.forEach(c => {
                    if (c.nodes) {
                        c.nodes.sort((a, b) => {
                            let matCmp = (a.Material || "").localeCompare(b.Material || "");
                            if (matCmp !== 0) return matCmp;
                            let plantCmp = (a.Plant || "").localeCompare(b.Plant || "");
                            if (plantCmp !== 0) return plantCmp;
                            return (a.ProdVersion || "").localeCompare(b.ProdVersion || "", undefined, { numeric: true });
                        });
                    }
                });
            });

            this._recalculateEntireTree(aTree);
            return aTree;
        },

        _recalculateEntireTree(aTree) {
            aTree.forEach(oTop => {
                if (oTop.Category === "DEMAND" || oTop.Category === "SUPPLY") {
                    if (oTop.nodes) {
                        oTop.nodes.forEach(oMid => {
                            if (oMid.nodes && oMid.nodes.length > 0) {
                                for (let i = 1; i <= 54; i++) {
                                    let nSum = oMid.nodes.reduce((sum, leaf) => sum + (Number(leaf["W" + i]) || 0), 0);
                                    oMid["W" + i] = Number(nSum.toFixed(3)); 
                                }
                            }
                        });
                        for (let i = 1; i <= 54; i++) {
                            let nSum = oTop.nodes.reduce((sum, mid) => sum + (Number(mid["W" + i]) || 0), 0);
                            oTop["W" + i] = Number(nSum.toFixed(3)); 
                        }
                    }
                } 
                else if (oTop.Category === "INVENTORY") {
                    if (oTop.nodes && oTop.nodes.length > 0) {
                        for (let i = 1; i <= 54; i++) {
                            let nSum = oTop.nodes.reduce((sum, leaf) => sum + (Number(leaf["W" + i]) || 0), 0);
                            oTop["W" + i] = Number(nSum.toFixed(3)); 
                        }
                    }
                }
            });
        },

        // =========================================================
        // 4. SEARCH, FILTERS & VALUE HELPS
        // =========================================================
        _buildTokenFilters(sField, aTokens) {
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
            const oODataModel = this.getOwnerComponent().getModel();
            const aMatTokens = this.byId("inpMaterial").getTokens();
            const aPlantTokens = this.byId("inpPlant").getTokens();
            const aVendorTokens = this.byId("inpVendor").getTokens();
            const oDR = this.byId("inpDateRange");
            const sPer = this.byId("inpPeriod").getSelectedKey(); 

            if (!oDR.getDateValue() || aPlantTokens.length === 0 || aMatTokens.length === 0) {
                return MessageBox.error("Mandatory fields missing: Plant, Material, and Horizon.");
            }

            const dStartDate = oDR.getDateValue();
            const dEndDate = oDR.getSecondDateValue();

            this.onGenerateColumns(this._generateTimeBuckets(dStartDate, dEndDate, sPer));

            const aFilters = [];
            const oMatFilter = this._buildTokenFilters("Material", aMatTokens);
            if (oMatFilter) aFilters.push(oMatFilter);

            const oPlantFilter = this._buildTokenFilters("Plant", aPlantTokens);
            if (oPlantFilter) aFilters.push(oPlantFilter);
            
            const oVendorFilter = this._buildTokenFilters("Vendor", aVendorTokens);
            if (oVendorFilter) aFilters.push(oVendorFilter);

            const dStartFilter = new Date(Date.UTC(dStartDate.getFullYear(), dStartDate.getMonth(), dStartDate.getDate()));
            const dEndFilter = new Date(Date.UTC(dEndDate.getFullYear(), dEndDate.getMonth(), dEndDate.getDate(), 23, 59, 59));

            aFilters.push(new Filter("AvailDate", FilterOperator.BT, dStartFilter, dEndFilter));
            aFilters.push(new Filter("Period", FilterOperator.EQ, sPer));

            this.getView().setBusy(true);
            
            const aAllResults = [];
            const fnFetchPage = (iSkip) => {
                oODataModel.read("/FlavorPlan", {
                    filters: aFilters,
                    urlParameters: { "$top": 1000, "$skip": iSkip }, 
                    success: (oData) => {
                        aAllResults.push(...oData.results);
                        
                        if (oData.results.length === 1000) {
                            fnFetchPage(iSkip + 1000);
                        } else {
                            this.getView().setBusy(false);
                            
                            this.getView().getModel("localModel").setProperty("/RawData", aAllResults);
                            const aResult = this._mapODataToSkeleton(aAllResults);
                            this.getView().getModel().setProperty("/mrpData", aResult);
                            
                            this._oBackupModel.setProperty("/mrpData", JSON.parse(JSON.stringify(aResult)));
                            
                            this.byId("idMrpTreeTable").expandToLevel(1);
                            MessageToast.show("Data loaded successfully.");
                        }
                    },
                    error: () => { 
                        this.getView().setBusy(false); 
                        MessageBox.error("Backend Error while fetching data."); 
                    }
                });
            };

            fnFetchPage(0);
        },

        _generateTimeBuckets(dStart, dEnd, sPeriod) {
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
            const oTable = this.byId("idMrpTreeTable");
            const aCols = oTable.getColumns();
            
            for (let i = aCols.length - 1; i >= 4; i--) oTable.removeColumn(aCols[i]).destroy();

            const oInputDecimalType = new TypeFloat({ minFractionDigits: 3, maxFractionDigits: 3, groupingEnabled: false, parseEmptyValueToZero: true });
            const oDisplayDecimalType = new TypeFloat({ minFractionDigits: 3, maxFractionDigits: 3, groupingEnabled: true, parseEmptyValueToZero: true });

            aBuckets.forEach(oBuck => {
                const oInp = new Input({
                    value: { path: oBuck.key, type: oInputDecimalType }, textAlign: "End",
                    visible: { 
                        parts: ['Category'], 
                        formatter: (category) => {
                            return !(category === "INVENTORY" || category === "DEMAND" || category === "SUPPLY");
                        } 
                    },
                    editable: { 
                        parts: ['nodes', 'BackendCategory', 'BackendMRPElement'], 
                        formatter: (nodes, category, backendMrp) => {
                            if (nodes && nodes.length > 0) return false; 
                            if (category === "1") return false;          
                            if (category === "3") return false;          
                            if (backendMrp === "STOs") return false;     
                            return true;                                 
                        } 
                    },
                    change: this.onValueChange.bind(this) 
                }).addCustomData(new CustomData({ key: "weekProp", value: oBuck.key }))
                  .addCustomData(new CustomData({ key: "columnLabel", value: oBuck.label }));

                oInp.addEventDelegate({ ondblclick: (e) => this.onCellDoubleClick(e.srcControl) });

                const oBoldTotals = new ObjectNumber({
                    number: { path: oBuck.key, type: oDisplayDecimalType }, emphasized: true, textAlign: "End",
                    visible: { 
                        parts: ['Category'], 
                        formatter: (category) => { return (category === "DEMAND" || category === "SUPPLY"); } 
                    }
                });

                const oInventoryText = new ObjectNumber({
                    number: { path: oBuck.key, type: oDisplayDecimalType }, emphasized: true, textAlign: "End",
                    visible: { path: 'Category', formatter: c => c === 'INVENTORY' },
                    state: { path: oBuck.key, formatter: v => Number(v) < 0 ? "Error" : "Success" }
                });

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
            const oInp = oEvent.getSource();
            const oMod = this.getView().getModel();
            const sWeek = oInp.data("weekProp"); 
            let sPath = oInp.getBindingContext().getPath();
            const oRow = oMod.getProperty(sPath);
            let nVal = Number(oInp.getValue()) || 0; 

            let nCellOldQty = Number(this._oBackupModel.getProperty(sPath + "/" + sWeek)) || 0;

            const aRawData = this.getView().getModel("localModel").getProperty("/RawData");
            const aBuckets = this.getView().getModel("localModel").getProperty("/TimeBuckets");

            let oStartDate = null, oEndDate = null;
            if (aBuckets) {
                const oBucketDef = aBuckets.find(b => b.key === sWeek);
                if (oBucketDef) { oStartDate = oBucketDef.startDate; oEndDate = oBucketDef.endDate; }
            }

            let sMat = oRow.Material || (this.byId("inpMaterial").getTokens()[0] ? this.byId("inpMaterial").getTokens()[0].getKey() : "");
            let sPlnt = oRow.Plant || (this.byId("inpPlant").getTokens()[0] ? this.byId("inpPlant").getTokens()[0].getKey() : "");

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

            const fnPushToLog = (oContext) => {
                const idx = this._aChangeLog.findIndex(c => 
                    c.Material === oContext.Material && c.Plant === oContext.Plant && c.ProdVersion === oContext.ProdVersion && 
                    c.MRPElement === oContext.MRPElement && c.PeriodBucket === oContext.PeriodBucket && 
                    c.PurchaseReq === oContext.PurchaseReq && c.LineItem === oContext.LineItem
                );
                if (idx !== -1) { this._aChangeLog[idx] = oContext; } else { this._aChangeLog.push(oContext); }
            };

            if (aMatches.length === 0) {
                fnPushToLog({ 
                    Material: sMat, Plant: sPlnt, Category: oRow.BackendCategory || "1", MRPElement: oRow.BackendMRPElement || "IndReq", 
                    ProdVersion: oRow.ProdVersion || " ", PeriodBucket: sWeek, NewQuantity: nVal, OldQuantity: nCellOldQty, 
                    PurchaseReq: "", LineItem: "", AvailDate: oStartDate, WkEndDate: oEndDate
                });
            } else {
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

            while (sPath.includes("/nodes/")) {
                const aParts = sPath.split("/"); aParts.pop(); aParts.pop(); sPath = aParts.join("/"); 
                const oPar = oMod.getProperty(sPath);
                if (oPar && oPar.nodes) {
                    let total = oPar.nodes.reduce((s, c) => s + (Number(c[sWeek]) || 0), 0);
                    oMod.setProperty(sPath + "/" + sWeek, Number(total.toFixed(3)));
                }
            }
        },

        onCellDoubleClick(oInp) {
            const oCtx = oInp.getBindingContext();
            const oRow = oCtx.getProperty();
            const sWeek = oInp.data("weekProp");

            if (oRow.nodes || !oRow.Material || oRow.Material === "") {
                MessageBox.information("Please expand the group and double-click on a specific Material line to see details.");
                return; 
            }

            if (Number(oRow[sWeek]) === 0) {
                MessageToast.show("No documents exist for this week.");
                return; 
            }

            if (oRow.BackendCategory === "1" || oRow.BackendCategory === "2" || oRow.BackendMRPElement === "BB") {
                this._showDocumentDetails(oInp, oRow, sWeek);
            } else {
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
            let aRawBackendData = this.getView().getModel("localModel").getProperty("/RawData");
            if (!aRawBackendData) return;

            let sTitle = (oRowData.MRPElement || "Document") + " Details";
            let sDocLabel = "Document Number"; 
            
            if (oRowData.BackendMRPElement === "PurRqs") sDocLabel = "Purchase Req";
            if (oRowData.BackendMRPElement === "PurOrd") sDocLabel = "Purchase Order";
            if (oRowData.BackendMRPElement === "SalesOrders") sDocLabel = "Sales Order";
            if (oRowData.BackendMRPElement === "IndReq") sDocLabel = "Plan Ind. Req";
            if (oRowData.BackendMRPElement === "DepReq") sDocLabel = "Dependent Req";
            if (oRowData.BackendMRPElement === "TransferRequirement") sDocLabel = "Transfer Req";
            if (oRowData.BackendMRPElement === "STOs") sDocLabel = "Stock Transport Order";

            let sConfig = { Title: sTitle, Col1Label: "Prod Ver Txt", DocColLabel: sDocLabel };

            let aMappedItems = aRawBackendData.filter(row => 
                row.Material === oRowData.Material && 
                row.ProdVersion === oRowData.ProdVersion && 
                row.MRPElement === oRowData.BackendMRPElement && 
                Number(row[sWeek]) > 0
            ).map(row => {
                let aParts = (row.ProdVersion || "").split(" / ");
                return {
                    Category: (oRowData.BackendCategory === "1" || row.Category === "1" || row.Category === "01") ? "Demand" : "Supply",
                    MRPElementText: oRowData.MRPElement, 
                    ProdVersion: aParts[0] ? aParts[0].trim() : "", 
                    Col1Value: aParts[1] ? aParts.slice(1).join(" / ").trim() : (row.ProdVerText || ""), 
                    DocNumber: row.PurchaseReq, 
                    DocItem: row.LineItem, 
                    Material: row.Material, 
                    Plant: oRowData.Plant, 
                    BackendCategory: oRowData.BackendCategory, 
                    BackendMRPElement: oRowData.BackendMRPElement, 
                    Description: row.MaterialDesc, 
                    Quantity: row[sWeek], 
                    AvailDate: row.AvailDate,
                    UoM: row.BaseUnit,
                    Vendor: row.Vendor,
                    Agreement: row.Agreement,
                    AgmtItem: row.AgmtItem
                };
            });

            this.getView().getModel("localModel").setProperty("/PopoverConfig", sConfig);
            this.getView().getModel("localModel").setProperty("/SelectedItems", aMappedItems);

            if (!this._pDocPopover) {
                this._pDocPopover = sap.ui.core.Fragment.load({ id: this.getView().getId(), name: "flavournamespace.flavourmodule.view.DocumentDetails", controller: this }).then(function(oPopover) {
                    this.getView().addDependent(oPopover); return oPopover;
                }.bind(this));
            }
            
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
            const oTable = this.byId("idDocDetailsTable");
            const aSelectedContexts = oTable.getSelectedContexts();

            if (aSelectedContexts.length === 0) return MessageBox.warning("Please select at least one document to convert.");

            const aSelectedPRs = aSelectedContexts.map(oContext => oContext.getObject());
            const oOData = this.getOwnerComponent().getModel();
            
            // ⭐ RESTORED TO BATCH MODE: Required to trigger ABAP Changesets so execute_save breakpoint hits!
            oOData.setUseBatch(true); 
            oOData.setDeferredGroups(["convertGrp"]);

            const fnToUTC = (d) => {
                if (!d) return null;
                return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
            };

            const oDR = this.byId("inpDateRange");
            const dGlobalStart = oDR.getDateValue();
            const dGlobalEnd = oDR.getSecondDateValue();
            const sPer = this.byId("inpPeriod").getSelectedKey();

            aSelectedPRs.forEach(pr => {
                let sFormattedDate = pr.AvailDate ? sap.ui.core.format.DateFormat.getDateInstance({pattern: "yyyyMMdd"}).format(pr.AvailDate) : "";
                
                const payload = { 
                    Material: pr.Material, Plant: pr.Plant, Category: pr.BackendCategory || "2", MRPElement: pr.BackendMRPElement, 
                    ProdVersion: pr.ProdVersion ? pr.ProdVersion : " ", PurchaseReq: pr.DocNumber, 
                    LineItem: pr.DocItem, ReqQuantity: pr.Quantity.toString(), BaseUnit: pr.UoM || "",
                    Vendor: pr.Vendor || "", // ⭐ FIX: Securely passes the PR's row-level vendor! No UI warning blocks here anymore!
                    AvailDate: fnToUTC(pr.AvailDate), GlobalStart: fnToUTC(dGlobalStart),
                    GlobalEnd: fnToUTC(dGlobalEnd), Period: sPer, WeekNo: sFormattedDate, IsConvert: true 
                };

                oOData.create("/FlavorPlan", payload, { groupId: "convertGrp" });
            });

            this.getView().setBusy(true);
            
            oOData.submitChanges({
                groupId: "convertGrp",
                success: (oData) => { 
                    this.getView().setBusy(false); 
                    
                    let aMsgs = this._extractBatchErrors(oData, aSelectedPRs);
                    let bHasError = aMsgs.some(m => m.type === "error" || m.type === "E" || m.type === "error");
                    
                    this._showAllMessages(aMsgs, "Conversion Operation", () => {
                        const oTableToClear = this.byId("idDocDetailsTable");
                        if (oTableToClear) oTableToClear.removeSelections(true);
                        
                        this.onCloseDocFragment(); 
                        this._aChangeLog = []; 
                        
                        if (!bHasError) {
                            const aEmptyTree = this._getEmptySkeleton();
                            this.getView().getModel().setProperty("/mrpData", aEmptyTree);
                            this._oBackupModel.setProperty("/mrpData", JSON.parse(JSON.stringify(aEmptyTree)));
                            this.onSearch(); 
                        } else {
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
            if (this._aChangeLog.length === 0) return MessageBox.information("No changes to save.");
            
            const oOData = this.getOwnerComponent().getModel();
            oOData.setUseBatch(true); 
            oOData.setDeferredGroups(["grp"]);

            const fnToUTC = (d) => {
                if (!d) return null;
                return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
            };

            const oDR = this.byId("inpDateRange");
            const dGlobalStart = oDR.getDateValue();
            const dGlobalEnd = oDR.getSecondDateValue();
            const sPer = this.byId("inpPeriod").getSelectedKey();

            this._aChangeLog.forEach(c => {
                let sWeekNum = c.PeriodBucket.replace("W", "");
                if (sWeekNum.length === 1) sWeekNum = "0" + sWeekNum; 
                let sFormattedColNo = "COL" + sWeekNum;               

                const payload = { 
                    Material: c.Material, Plant: c.Plant, Category: c.Category, MRPElement: c.MRPElement, 
                    ProdVersion: c.ProdVersion ? c.ProdVersion : " ", PurchaseReq: c.PurchaseReq, LineItem: c.LineItem, 
                    AvailDate: fnToUTC(c.AvailDate), WkEndDate: fnToUTC(c.WkEndDate),
                    GlobalStart: fnToUTC(dGlobalStart), GlobalEnd: fnToUTC(dGlobalEnd),
                    Period: sPer, WeekNo: sFormattedColNo, WeekQty: c.NewQuantity.toString(), ReqQuantity: c.OldQuantity.toString()
                };
                
                payload[c.PeriodBucket] = c.NewQuantity.toString(); 
                oOData.create("/FlavorPlan", payload, { groupId: "grp" });
            });

            this.getView().setBusy(true);
            
            oOData.submitChanges({
                groupId: "grp",
                success: (oData) => { 
                    this.getView().setBusy(false); 
                    
                    let aMsgs = this._extractBatchErrors(oData, this._aChangeLog);
                    let bHasError = aMsgs.some(m => m.type === "error" || m.type === "E" || m.type === "error");
                    
                    this._showAllMessages(aMsgs, "Save Operation", () => {
                        this._aChangeLog = []; 
                        
                        if (!bHasError) {
                            const aEmptyTree = this._getEmptySkeleton();
                            this.getView().getModel().setProperty("/mrpData", aEmptyTree);
                            this._oBackupModel.setProperty("/mrpData", JSON.parse(JSON.stringify(aEmptyTree)));
                            this.onSearch(); 
                        } else {
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
            if (!aMsgs || aMsgs.length === 0) {
                MessageToast.show(sTitle + " completed successfully.");
                if (fnCallback) fnCallback();
                return;
            }

            let bHasError = aMsgs.some(m => m.type === "error" || m.type === "E" || m.type === "error");
            const aUniqueMsgs = [...new Map(aMsgs.map(m => [m.message, m])).values()];

            let sMessageText = aUniqueMsgs.map(m => {
                let type = (m.type || "").toLowerCase();
                let sPrefix = "ℹ️ "; 
                if (type === "error" || type === "e") sPrefix = "❌ ";
                else if (type === "warning" || type === "w") sPrefix = "⚠️ ";
                else if (type === "success" || type === "s") sPrefix = "✅ ";
                return sPrefix + m.message;
            }).join("\n\n");

            if (bHasError) {
                MessageBox.error(sTitle + " completed with errors:\n\n" + sMessageText, { onClose: fnCallback });
            } else {
                MessageBox.information(sTitle + " Results:\n\n" + sMessageText, { onClose: fnCallback });
            }
        },

        _extractBatchErrors: function(oData, aContextArray) {
            let aMsgs = [];
            let iChangeIndex = 0; 

            if (oData && oData.__batchResponses) {
                oData.__batchResponses.forEach(res => {
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
                                let sErrMsg = oBody.error.message;
                                if (typeof sErrMsg === "object" && sErrMsg.value) sErrMsg = sErrMsg.value;
                                aMsgs.push({ type: "error", message: sErrMsg });
                            }
                        } catch (e) { aMsgs.push({ type: "error", message: res.message || "Unknown batch error." }); }
                    }
                    
                    if (res.headers && res.headers["sap-message"]) {
                        this._parseSapMessageHeader(res.headers["sap-message"], aMsgs, "");
                    }

                    if (res.__changeResponses) {
                        res.__changeResponses.forEach(changeRes => {
                            let oContext = (aContextArray && aContextArray[iChangeIndex]) ? aContextArray[iChangeIndex] : {};
                            let sPrefix = "";
                            
                            if (oContext.DocNumber) sPrefix = `[PR ${oContext.DocNumber}]: `;
                            else if (oContext.PurchaseReq) sPrefix = `[PR ${oContext.PurchaseReq}]: `;
                            else if (oContext.Material) sPrefix = `[Mat ${oContext.Material} - ${oContext.PeriodBucket || oContext.Plant}]: `;

                            if (changeRes.headers && changeRes.headers["sap-message"]) {
                                this._parseSapMessageHeader(changeRes.headers["sap-message"], aMsgs, sPrefix);
                            }
                            
                            if (changeRes.response && changeRes.response.body) {
                                try {
                                    let oBody = JSON.parse(changeRes.response.body);
                                    if (oBody.error && oBody.error.message) {
                                        let sErrMsg = oBody.error.message;
                                        if (typeof sErrMsg === "object" && sErrMsg.value) sErrMsg = sErrMsg.value;
                                        if (sErrMsg) aMsgs.push({ type: "error", message: sPrefix + sErrMsg });
                                    }
                                } catch(e) {}
                            }
                            iChangeIndex++;
                        });
                    }
                });
            }
            return aMsgs;
        },

        _parseSapMessageHeader: function(sSapMessage, aMsgs, sPrefix) {
            try {
                let oSapMsg = JSON.parse(sSapMessage);
                sPrefix = sPrefix || "";
                
                let sMainMsg = oSapMsg.message;
                if (typeof sMainMsg === "object" && sMainMsg.value) sMainMsg = sMainMsg.value;
                if (sMainMsg) aMsgs.push({ type: oSapMsg.severity, message: sPrefix + sMainMsg });

                if (oSapMsg.details) {
                    oSapMsg.details.forEach(d => {
                        let sDetMsg = d.message;
                        if (typeof sDetMsg === "object" && sDetMsg.value) sDetMsg = sDetMsg.value;
                        if (sDetMsg && sDetMsg !== sMainMsg) {
                            aMsgs.push({ type: d.severity, message: sPrefix + sDetMsg });
                        }
                    });
                }
            } catch(e) {}
        },

        _parseODataError: function (oError) {
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
                    let sErrMsg = oResponse.error.message;
                    if (typeof sErrMsg === "object" && sErrMsg.value) sErrMsg = sErrMsg.value;
                    aMsgs.push({ type: "error", message: sErrMsg });
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
        onCloseDocFragment: function () { if (this._pDocPopover) this._pDocPopover.then(function(oPopover){ oPopover.close(); }); },

        onExit: function () {
            if (this._oDetailDialog) {
                this._oDetailDialog.destroy();
            }
            if (this._pDocPopover) {
                this._pDocPopover.then(function (oPopover) { oPopover.destroy(); });
            }
        }

    });
});