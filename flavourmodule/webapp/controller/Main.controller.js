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

        onInit() {
            window.myDebug = this; 

            const oEmptyModel = new JSONModel({ mrpData: this._getEmptySkeleton() });
            this.getView().setModel(oEmptyModel);

            this._oBackupModel = new JSONModel({ mrpData: this._getEmptySkeleton() });

            const oLocalModel = new JSONModel({
                RawData: [],
                PopoverConfig: {},
                SelectedItems: [],
                TimeBuckets: [] 
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

        _loadVariants() {
            const oVM = this.byId("idVariantManagement");
            const sData = localStorage.getItem("flavorVariants");
            
            if (sData) {
                this._aCustomVariants = JSON.parse(sData);
                this._aCustomVariants.forEach(v => {
                    oVM.addItem(new CoreItem({ key: v.key, text: v.name }));
                });
            } else {
                this._aCustomVariants = [];
            }

            const sDef = localStorage.getItem("flavorDefVariant");
            if (sDef) {
                oVM.setDefaultVariantKey(sDef);
                oVM.setInitialSelectionKey(sDef);
                setTimeout(() => this._applyVariant(sDef), 300);
            }
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
                this.byId("idVariantManagement").addItem(new CoreItem({ key: sKey, text: sName }));
            }

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

        _getEmptySkeleton() {
            const oEmptyWeeks = {};
            for (let i = 1; i <= 54; i++) { oEmptyWeeks["W" + i] = 0; }

            return [
                {
                    Category: "DEMAND", MRPElement: " ", BackendCategory: "1", BackendMRPElement: "XX", ...oEmptyWeeks,design: 'Bold',
                    nodes: [
                        { Category: "", MRPElement: "Independent Demand", BackendCategory: "1", BackendMRPElement: "IndReq", ...oEmptyWeeks, nodes: [] },
                        { Category: "", MRPElement: "SalesOrders", BackendCategory: "1", BackendMRPElement: "SalesOrders", ...oEmptyWeeks, nodes: [] },
                        { Category: "", MRPElement: "Dependent Requirements", BackendCategory: "1", BackendMRPElement: "DepReq", ...oEmptyWeeks, nodes: [] }
                    ]
                },
                {
                    Category: "SUPPLY", MRPElement: " ", BackendCategory: "2", BackendMRPElement: "XX", ...oEmptyWeeks,
                    nodes: [
                        { Category: "", MRPElement: "PurReq", BackendCategory: "2", BackendMRPElement: "PurRqs", ...oEmptyWeeks, nodes: [] },
                        { Category: "", MRPElement: "PurOrd", BackendCategory: "2", BackendMRPElement: "PurOrd", ...oEmptyWeeks, nodes: [] }
                    ]
                },
                {
                    Category: "INVENTORY", MRPElement: "Stock Balance", BackendCategory: "3", BackendMRPElement: "XX", ...oEmptyWeeks,
                    nodes: []
                }
            ];
        },

        _mapODataToSkeleton(aFlatData) {
            const aTree = this._getEmptySkeleton();

            aFlatData.forEach(oRow => {
                let sCat = "";
                if (oRow.Category) {
                    sCat = parseInt(oRow.Category, 10).toString(); 
                }
                
                const sMrp = (oRow.MRPElement || "").trim();
                const sPlant = (oRow.Plant || "").trim(); 
                const sVer = (oRow.ProdVersion || "").trim(); 

                aTree.forEach(oParent => {
                    if (oParent.nodes) {
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
                                        Category: "", MRPElement: "", 
                                        ProdVersion: sVer, 
                                        Material: oRow.Material,
                                        Plant: sPlant, 
                                        BackendCategory: sCat, 
                                        BackendMRPElement: sMrp
                                    };
                                    for (let i = 1; i <= 54; i++) { oLeaf["W" + i] = Number(oRow["W" + i]) || 0; }
                                    oChild.nodes.push(oLeaf);
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
                            let plantCmp = a.Plant.localeCompare(b.Plant);
                            if (plantCmp !== 0) return plantCmp;
                            return a.ProdVersion.localeCompare(b.ProdVersion, undefined, { numeric: true });
                        });
                    }
                });
            });

            this._recalculateEntireTree(aTree);
            return aTree;
        },

        _recalculateEntireTree(aTree) {
            let oInv = null, oDem = null, oSup = null;

            aTree.forEach(oTop => {
                if (oTop.Category === "DEMAND") oDem = oTop;
                if (oTop.Category === "SUPPLY") oSup = oTop;
                if (oTop.Category === "INVENTORY") oInv = oTop;

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
            });

            if (oInv && oSup && oDem) {
                for (let i = 1; i <= 54; i++) oInv["W" + i] = (Number(oSup["W" + i]) || 0) - (Number(oDem["W" + i]) || 0);
            }
        },

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
            oODataModel.read("/FlavorPlan", {
                filters: aFilters,
                success: oData => {
                    this.getView().setBusy(false);
                    this.getView().getModel("localModel").setProperty("/RawData", oData.results);
                    const aResult = this._mapODataToSkeleton(oData.results);
                    this.getView().getModel().setProperty("/mrpData", aResult);
                    this._oBackupModel.setProperty("/mrpData", JSON.parse(JSON.stringify(aResult)));
                    
                    this.byId("idMrpTreeTable").expandToLevel(1);
                    
                    MessageToast.show("Data loaded successfully.");
                },
                error: () => { this.getView().setBusy(false); MessageBox.error("Backend Error."); }
            });
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

            const oInputDecimalType = new TypeFloat({ 
                minFractionDigits: 3, maxFractionDigits: 3, 
                groupingEnabled: false, parseEmptyValueToZero: true 
            });

            const oDisplayDecimalType = new TypeFloat({ 
                minFractionDigits: 3, maxFractionDigits: 3, 
                groupingEnabled: true, parseEmptyValueToZero: true 
            });

            aBuckets.forEach(oBuck => {
                
                // 1. The Input Box (Hidden ONLY for Inventory, Demand Totals, and Supply Totals)
                const oInp = new Input({
                    value: { path: oBuck.key, type: oInputDecimalType }, 
                    textAlign: "End",
                    visible: { 
                        parts: ['Category'], 
                        formatter: (category) => {
                            if (category === "INVENTORY" || category === "DEMAND" || category === "SUPPLY") {
                                return false; 
                            }
                            return true;
                        } 
                    },
                    editable: { 
                        parts: ['nodes', 'BackendCategory'], 
                        formatter: (nodes, category) => {
                            if (nodes && nodes.length > 0) return false;
                            if (category === "1") return false;
                            return true;
                        } 
                    },
                    change: this.onValueChange.bind(this)
                }).addCustomData(new CustomData({ key: "weekProp", value: oBuck.key }))
                  .addCustomData(new CustomData({ key: "columnLabel", value: oBuck.label }));

                oInp.addEventDelegate({ ondblclick: (e) => this.onCellDoubleClick(e.srcControl) });

                // 2. THE BOLD TOTALS (Visible ONLY for Demand and Supply top rows)
                const oBoldTotals = new ObjectNumber({
                    number: { path: oBuck.key, type: oDisplayDecimalType }, 
                    emphasized: true, // <--- THIS MAKES THE NUMBERS BOLD
                    textAlign: "End",
                    visible: { 
                        parts: ['Category'], 
                        formatter: (category) => {
                            return (category === "DEMAND" || category === "SUPPLY");
                        } 
                    }
                });

                // 3. The Inventory Text
                const oInventoryText = new ObjectNumber({
                    number: { path: oBuck.key, type: oDisplayDecimalType }, 
                    emphasized: true, textAlign: "End",
                    visible: { path: 'Category', formatter: c => c === 'INVENTORY' },
                    state: { path: oBuck.key, formatter: v => Number(v) < 0 ? "Error" : "Success" }
                });

                oTable.addColumn(new Column({
                    label: new Label({ text: oBuck.label, design: "Bold", textAlign: "End", width: "100%" }),
                    width: "150px", 
                    autoResizable: true,
                    hAlign: "End",
                    template: new HBox({ justifyContent: "End", items: [
                        oInp,
                        oBoldTotals, // <--- Injected here
                        oInventoryText
                    ]})
                }));
            });
        },

        onValueChange(oEvent) {
            const oInp = oEvent.getSource();
            const oMod = this.getView().getModel();
            const sWeek = oInp.data("weekProp");
            let sPath = oInp.getBindingContext().getPath();
            const oRow = oMod.getProperty(sPath);
            let nVal = Number(oInp.getValue()) || 0; 

            const aRawData = this.getView().getModel("localModel").getProperty("/RawData");
            const aBuckets = this.getView().getModel("localModel").getProperty("/TimeBuckets");
            
            let oEndDate = null;
            if (aBuckets) {
                const oBucketDef = aBuckets.find(b => b.key === sWeek);
                if (oBucketDef) oEndDate = oBucketDef.endDate;
            }

            // =========================================================
            // THE FIX: Dynamically pull Material and Plant from FilterBar if Row is Empty
            // =========================================================
            let sMat = oRow.Material;
            if (!sMat) {
                const aMatTokens = this.byId("inpMaterial").getTokens();
                if (aMatTokens.length > 0) sMat = aMatTokens[0].getKey();
            }

            let sPlnt = oRow.Plant;
            if (!sPlnt) {
                const aPlntTokens = this.byId("inpPlant").getTokens();
                if (aPlntTokens.length > 0) sPlnt = aPlntTokens[0].getKey();
            }

            let aMatches = [];
            if (aRawData) {
                aMatches = aRawData.filter(r => 
                    r.Material === oRow.Material && r.Plant === oRow.Plant && 
                    r.ProdVersion === oRow.ProdVersion && r.MRPElement === oRow.BackendMRPElement &&
                    Number(r[sWeek]) > 0 
                );
            }

            const fnPushToLog = (oContext) => {
                const idx = this._aChangeLog.findIndex(c => 
                    c.Material === oContext.Material && c.Plant === oContext.Plant && 
                    c.ProdVersion === oContext.ProdVersion && c.MRPElement === oContext.MRPElement &&
                    c.PeriodBucket === oContext.PeriodBucket && c.PurchaseReq === oContext.PurchaseReq && 
                    c.LineItem === oContext.LineItem
                );
                if (idx !== -1) { this._aChangeLog[idx] = oContext; } 
                else { this._aChangeLog.push(oContext); }
            };

            if (aMatches.length === 0) {
                // For completely empty buckets being newly created
                fnPushToLog({ 
                    Material: sMat,                 // Extracted fallback 
                    Plant: sPlnt,                   // Extracted fallback
                    Category: oRow.BackendCategory || "2", 
                    MRPElement: oRow.BackendMRPElement || "PurRqs", 
                    ProdVersion: oRow.ProdVersion || " ", 
                    PeriodBucket: sWeek, 
                    NewQuantity: nVal, 
                    OldQuantity: 0, 
                    PurchaseReq: "", 
                    LineItem: "", 
                    AvailDate: oEndDate,            // <--- CRITICAL FIX: Passes a valid Date instead of null!
                    WkEndDate: oEndDate 
                });
            } else {
                aMatches.forEach(oMatch => {
                    let nItemOldQty = Number(oMatch[sWeek]) || 0;
                    fnPushToLog({ 
                        Material: sMat, 
                        Plant: sPlnt, 
                        Category: oRow.BackendCategory, 
                        MRPElement: oRow.BackendMRPElement, 
                        ProdVersion: oRow.ProdVersion, 
                        PeriodBucket: sWeek, 
                        NewQuantity: nVal,         
                        OldQuantity: nItemOldQty,  
                        PurchaseReq: oMatch.PurchaseReq || "",
                        LineItem: oMatch.LineItem || "", 
                        AvailDate: oMatch.AvailDate,
                        WkEndDate: oEndDate 
                    });
                });
            }

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

        onSave() {
            if (this._aChangeLog.length === 0) return MessageBox.information("No changes to save.");
            const oOData = this.getOwnerComponent().getModel();
            oOData.setUseBatch(true);
            oOData.setDeferredGroups(["grp"]);

            const oDateFmt = sap.ui.core.format.DateFormat.getDateInstance({pattern: "yyyyMMdd"});

            this._aChangeLog.forEach(c => {
                
                let sEndStr = c.WkEndDate ? oDateFmt.format(c.WkEndDate) : "";

                const payload = { 
                    Material: c.Material, 
                    Plant: c.Plant, 
                    Category: c.Category, 
                    MRPElement: c.MRPElement, 
                    ProdVersion: c.ProdVersion ? c.ProdVersion : " ", 
                    PurchaseReq: c.PurchaseReq, 
                    LineItem: c.LineItem, 
                    AvailDate: c.AvailDate, 
                    WkEndDate: c.WkEndDate,
                    WeekNo: c.PeriodBucket + (sEndStr ? "|" + sEndStr : ""),               
                    WeekQty: c.NewQuantity.toString(),    
                    ReqQuantity: c.OldQuantity.toString() 
                };
                
                payload[c.PeriodBucket] = c.NewQuantity.toString();
                
                oOData.create("/FlavorPlan", payload, { groupId: "grp" });
            });

            this.getView().setBusy(true);
            oOData.submitChanges({
                groupId: "grp",
                success: () => { 
                    this.getView().setBusy(false); 
                    MessageToast.show("Saved successfully via POST."); 
                    this._aChangeLog = []; 
                    
                    this.getView().getModel().refresh(); 
                    this.onSearch(); 
                },
                error: () => { 
                    this.getView().setBusy(false); 
                    MessageBox.error("Save Error."); 
                }
            });
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

        onCloseDocFragment: function () {
            if (this._pDocPopover) {
                this._pDocPopover.then(function(oPopover){ oPopover.close(); });
            }
        },

        _showDocumentDetails: function (oInput, oRowData, sWeek) {
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
                        Plant: oRowData.Plant, BackendCategory: oRowData.BackendCategory, 
                        BackendMRPElement: "PurRqs", 
                        Description: row.MaterialDesc, Quantity: row.ReqQuantity, AvailDate: row.AvailDate
                    };
                });
            } else if (oRowData.BackendMRPElement === "PurOrd") {  
                sConfig = { Title: "Purchase Order Details", Col1Label: "Prod Ver Txt", DocColLabel: "Purchase Order" };
                aMappedItems = aRawBackendData.filter(row => 
                    row.Material === oRowData.Material && row.ProdVersion === oRowData.ProdVersion && 
                    row.MRPElement === "PurOrd" && Number(row[sWeek]) > 0 
                ).map(row => {
                    let aParts = (row.ProdVersion || "").split(" / ");
                    return {
                        Category: "Supply", MRPElementText: "Purchase Order", ProdVersion: aParts[0] ? aParts[0].trim() : "", 
                        Col1Value: aParts[1] ? aParts.slice(1).join(" / ").trim() : (row.ProdVerText || ""), 
                        DocNumber: row.PurchaseReq, DocItem: row.LineItem, Material: row.Material, 
                        Plant: oRowData.Plant, BackendCategory: oRowData.BackendCategory, 
                        BackendMRPElement: "PurOrd", 
                        Description: row.MaterialDesc, Quantity: row.ReqQuantity, AvailDate: row.AvailDate
                    };
                });
            }

            this.getView().getModel("localModel").setProperty("/PopoverConfig", sConfig);
            this.getView().getModel("localModel").setProperty("/SelectedItems", aMappedItems);

            if (!this._pDocPopover) {
                this._pDocPopover = sap.ui.core.Fragment.load({
                    id: this.getView().getId(), name: "flavournamespace.flavourmodule.view.DocumentDetails", controller: this
                }).then(function(oPopover) {
                    this.getView().addDependent(oPopover); return oPopover;
                }.bind(this));
            }
            this._pDocPopover.then(function(oPopover) { 
                const oTable = this.byId("idDocDetailsTable");
                if (oTable) oTable.removeSelections(true); 
                oPopover.openBy(oInput); 
            }.bind(this));
        },

        onCellDoubleClick(oInp) {
            const oCtx = oInp.getBindingContext();
            const oRow = oCtx.getProperty();
            const sWeek = oInp.data("weekProp");

            if (oRow.BackendMRPElement === "PurRqs" || oRow.BackendMRPElement === "PurOrd" || oRow.BackendMRPElement === "BB") {
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

        onConvertPrToPo: function () {
            const oTable = this.byId("idDocDetailsTable");
            const aSelectedContexts = oTable.getSelectedContexts();

            if (aSelectedContexts.length === 0) {
                MessageBox.warning("Please select at least one document to convert.");
                return;
            }

            const aSelectedPRs = aSelectedContexts.map(oContext => oContext.getObject());
            const oOData = this.getOwnerComponent().getModel();
            
            oOData.setUseBatch(true);
            oOData.setDeferredGroups(["convertGrp"]);

            aSelectedPRs.forEach(pr => {
                const payload = { 
                    Material: pr.Material, 
                    Plant: pr.Plant, 
                    Category: pr.BackendCategory || "2", 
                    MRPElement: pr.BackendMRPElement, 
                    ProdVersion: pr.ProdVersion ? pr.ProdVersion : " ", 
                    PurchaseReq: pr.DocNumber, 
                    LineItem: pr.DocItem, 
                    ReqQuantity: pr.Quantity.toString(),
                    AvailDate: pr.AvailDate,
                    IsConvert: true 
                };
                
                oOData.create("/FlavorPlan", payload, { groupId: "convertGrp" });
            });

            this.getView().setBusy(true);
            
            oOData.submitChanges({
                groupId: "convertGrp",
                success: () => { 
                    this.getView().setBusy(false); 
                    MessageToast.show("Processing successful!"); 
                    
                    const oTableToClear = this.byId("idDocDetailsTable");
                    if (oTableToClear) {
                        oTableToClear.removeSelections(true);
                    }
                    
                    this.onCloseDocFragment(); 
                    this._aChangeLog = []; 
                    
                    this.getView().getModel().refresh(); 
                    this.onSearch(); 
                },
                error: () => { 
                    this.getView().setBusy(false); 
                    MessageBox.error("Processing failed."); 
                }
            });
        },

        onCloseFragment() { if (this._oDetailDialog) this._oDetailDialog.close(); }
    });
});