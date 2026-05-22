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
    "sap/m/VariantItem",
    "sap/m/Title"
], (Controller, JSONModel, MessageToast, MessageBox, Input, Label, Column, CustomData, DateFormat, VBox, HBox, ObjectStatus, ObjectNumber, Fragment, Token, Filter, FilterOperator, ValueHelpDialog, TypeString, TypeFloat, VariantItem, Title) => {
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
                SavedVariants: [],
                GlobalUoM: ""
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

            const oMatInput = this.byId("inpMaterial");
            if (oMatInput) {
                oMatInput.addValidator(args => {
                    let sText = args.text.toUpperCase(); 
                    let sKey = sText.startsWith("=") ? sText.substring(1) : sText;
                    
                    if (oMatInput.getTokens().length >= 1) {
                        MessageBox.information("You can only evaluate one Material at a time. Please remove the current Material before adding a new one.");
                        return null; 
                    }
                    
                    return new Token({ key: sKey, text: sText });
                });
                oMatInput.attachLiveChange(oEvent => {
                    let sValue = oEvent.getParameter("value");
                    if (sValue !== sValue.toUpperCase()) oEvent.getSource().setValue(sValue.toUpperCase());
                });
            }

            ["inpPlant", "inpVendor"].forEach(id => {
                const oInput = this.byId(id);
                if (oInput) {
                    oInput.addValidator(fnTokenValidator);
                    oInput.attachLiveChange(oEvent => {
                        let sValue = oEvent.getParameter("value");
                        if (sValue !== sValue.toUpperCase()) oEvent.getSource().setValue(sValue.toUpperCase());
                    });
                }
            });

            this._sContainerId = "Z_FLAVOR_PLAN_VARIANTS"; 
            
            if (sap.ushell && sap.ushell.Container) {
                sap.ushell.Container.getServiceAsync("Personalization").then(oService => {
                    const oScope = {
                        keyCategory: oService.constants.keyCategory.FIXED_KEY,
                        writeFrequency: oService.constants.writeFrequency.LOW,
                        clientStorageAllowed: true
                    };
                    oService.getContainer(this._sContainerId, oScope).then(oContainer => {
                        this._oVariantContainer = oContainer;
                        this._loadVariantsIntoUI();
                    });
                }).catch(() => { this._initLocalStorageFallback(); });
            } else {
                this._initLocalStorageFallback(); 
            }
        },

        // =========================================================
        // 2. VARIANT MANAGEMENT
        // =========================================================
        _loadVariantsIntoUI() {
            const aKeys = this._oVariantContainer.getItemKeys();
            this._aCustomVariants = [];
            let sDefKey = null;

            aKeys.forEach(sKey => {
                if (sKey === "DEFAULT_VARIANT_KEY") {
                    sDefKey = this._oVariantContainer.getItemValue(sKey);
                } else {
                    const oVal = this._oVariantContainer.getItemValue(sKey);
                    if (oVal) { 
                        if (!oVal.author) { oVal.author = "Legacy User"; }
                        this._aCustomVariants.push(oVal); 
                    }
                }
            });

            this.getView().getModel("localModel").setProperty("/SavedVariants", this._aCustomVariants);
            
            const oVM = this.byId("idVariantManagement");
            if (sDefKey && oVM) {
                oVM.setDefaultKey(sDefKey); 
                oVM.setSelectedKey(sDefKey); 
                setTimeout(() => this._applyVariant(sDefKey), 300); 
            }
        },

        onSaveVariant(oEvent) {
            const sName = oEvent.getParameter("name");
            const bOverwrite = oEvent.getParameter("overwrite");
            const bDefault = oEvent.getParameter("def");
            let sKey = oEvent.getParameter("key");

            const fnGetTokens = (id) => this.byId(id).getTokens().map(t => ({ key: t.getKey(), text: t.getText(), range: t.data("range") }));
            const oDR = this.byId("inpDateRange");
            
            // TIMEZONE FIX
            const oFmt = DateFormat.getDateInstance({pattern: "yyyy-MM-dd"});

            const oState = {
                material: fnGetTokens("inpMaterial"),
                plant: fnGetTokens("inpPlant"),
                vendor: fnGetTokens("inpVendor"),
                // TIMEZONE FIX
                dateStart: oDR.getDateValue() ? oFmt.format(oDR.getDateValue()) : null,
                dateEnd: oDR.getSecondDateValue() ? oFmt.format(oDR.getSecondDateValue()) : null,
                period: this.byId("inpPeriod").getSelectedKey()
            };

            if (!bOverwrite || !sKey) { sKey = "VAR_" + Date.now(); }

            let sAuthor = "Unknown User";
            if (sap.ushell && sap.ushell.Container) {
                let oUser = sap.ushell.Container.getUser();
                sAuthor = oUser.getFullName() || oUser.getId() || "Standard User";
            }

            const oVariantRecord = { key: sKey, name: sName, state: oState, author: sAuthor };

            if (this._oVariantContainer) {
                this._oVariantContainer.setItemValue(sKey, oVariantRecord);
                if (bDefault) {
                    this.byId("idVariantManagement").setDefaultKey(sKey);
                    this._oVariantContainer.setItemValue("DEFAULT_VARIANT_KEY", sKey);
                }
                this._oVariantContainer.save().then(() => {
                    MessageToast.show("Variant saved successfully to Fiori Launchpad.");
                    this._loadVariantsIntoUI(); 
                }).catch(() => { MessageBox.error("Failed to save variant to Fiori Launchpad."); });
            } else {
                const oExisting = this._aCustomVariants.find(v => v.key === sKey);
                if (oExisting) {
                    oExisting.state = oState; 
                    oExisting.author = sAuthor;
                } else {
                    this._aCustomVariants.push(oVariantRecord);
                }
                
                if (bDefault) { this.byId("idVariantManagement").setDefaultKey(sKey); localStorage.setItem("flavorDefVariant", sKey); }
                this.getView().getModel("localModel").setProperty("/SavedVariants", this._aCustomVariants);
                localStorage.setItem("flavorVariants", JSON.stringify(this._aCustomVariants));
                MessageToast.show("Variant saved locally.");
            }
        },

        onSelectVariant(oEvent) {
            const sKey = oEvent.getParameter("key");
            this._applyVariant(sKey);
        },

        _applyVariant(sKey) {
            if (sKey === "*standard*" || !sKey) {
                this.byId("inpMaterial").removeAllTokens();
                this.byId("inpPlant").removeAllTokens();
                this.byId("inpVendor").removeAllTokens();
                this.byId("inpDateRange").setValue("");
                this.byId("inpPeriod").setSelectedKey("W");
                return;
            }

            const oVariant = this._aCustomVariants.find(v => v.key === sKey);
            if (oVariant && oVariant.state) {
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
                
                // TIMEZONE FIX
                const oDR = this.byId("inpDateRange");
                const oFmt = DateFormat.getDateInstance({pattern: "yyyy-MM-dd"});

                if (oVariant.state.dateStart) {
                    if (typeof oVariant.state.dateStart === "number") oDR.setDateValue(new Date(oVariant.state.dateStart));
                    else oDR.setDateValue(oFmt.parse(oVariant.state.dateStart));
                }
                if (oVariant.state.dateEnd) {
                    if (typeof oVariant.state.dateEnd === "number") oDR.setSecondDateValue(new Date(oVariant.state.dateEnd));
                    else oDR.setSecondDateValue(oFmt.parse(oVariant.state.dateEnd));
                }
                
                this.byId("inpPeriod").setSelectedKey(oVariant.state.period || "W");
                this.onSearch(); 
            }
        },

        onManageVariant(oEvent) {
            const aDeleted = oEvent.getParameter("deleted") || [];
            const aRenamed = oEvent.getParameter("renamed") || [];
            const sDef = oEvent.getParameter("def");

            if (this._oVariantContainer) {
                aDeleted.forEach(sDelKey => {
                    this._oVariantContainer.delItem(sDelKey);
                    if (this._oVariantContainer.getItemValue("DEFAULT_VARIANT_KEY") === sDelKey) {
                        this._oVariantContainer.delItem("DEFAULT_VARIANT_KEY");
                    }
                });

                aRenamed.forEach(oRename => {
                    const oVar = this._oVariantContainer.getItemValue(oRename.key);
                    if (oVar) {
                        oVar.name = oRename.name;
                        this._oVariantContainer.setItemValue(oRename.key, oVar);
                    }
                });

                if (sDef !== undefined) {
                    if (sDef === "*standard*") this._oVariantContainer.delItem("DEFAULT_VARIANT_KEY");
                    else this._oVariantContainer.setItemValue("DEFAULT_VARIANT_KEY", sDef);
                }

                this._oVariantContainer.save().then(() => { this._loadVariantsIntoUI(); });

            } else {
                aDeleted.forEach(sDelKey => {
                    this._aCustomVariants = this._aCustomVariants.filter(v => v.key !== sDelKey);
                    if (localStorage.getItem("flavorDefVariant") === sDelKey) localStorage.removeItem("flavorDefVariant"); 
                });
                aRenamed.forEach(oRename => {
                    const oVar = this._aCustomVariants.find(v => v.key === oRename.key);
                    if (oVar) oVar.name = oRename.name;
                });
                if (sDef !== undefined) localStorage.setItem("flavorDefVariant", sDef);
                this.getView().getModel("localModel").setProperty("/SavedVariants", this._aCustomVariants);
                localStorage.setItem("flavorVariants", JSON.stringify(this._aCustomVariants));
            }
        },

        _initLocalStorageFallback() {
            const sData = localStorage.getItem("flavorVariants"); 
            this._aCustomVariants = sData ? JSON.parse(sData) : [];
            this.getView().getModel("localModel").setProperty("/SavedVariants", this._aCustomVariants);
            const oVM = this.byId("idVariantManagement");
            const sDef = localStorage.getItem("flavorDefVariant");
            if (sDef && oVM) {
                oVM.setDefaultKey(sDef); 
                oVM.setSelectedKey(sDef); 
                setTimeout(() => this._applyVariant(sDef), 300); 
            }
        },

        // =========================================================
        // ⭐ STRICT BUCKET BOUNDARY ALIGNMENT (TIMEZONE FIXED)
        // =========================================================
        _getAdjustedDates() {
            const oDR = this.byId("inpDateRange");
            const sPer = this.byId("inpPeriod").getSelectedKey();
            if (!oDR || !oDR.getDateValue()) return null;

            // TIMEZONE FIX
            let dVal = oDR.getDateValue();
            let dEndVal = oDR.getSecondDateValue();

            let dStart = new Date(Date.UTC(dVal.getFullYear(), dVal.getMonth(), dVal.getDate()));
            let dEnd = new Date(Date.UTC(dEndVal.getFullYear(), dEndVal.getMonth(), dEndVal.getDate()));

            if (sPer === "W") {
                const iDayStart = dStart.getUTCDay(); 
                const iDiffStart = dStart.getUTCDate() - iDayStart + (iDayStart === 0 ? -6 : 1);
                dStart.setUTCDate(iDiffStart);

                const iDayEnd = dEnd.getUTCDay();
                const iDiffEnd = dEnd.getUTCDate() - iDayEnd + (iDayEnd === 0 ? 0 : 7);
                dEnd.setUTCDate(iDiffEnd);

            } else if (sPer === "M") {
                dStart = new Date(Date.UTC(dStart.getUTCFullYear(), dStart.getUTCMonth(), 1));
                dEnd = new Date(Date.UTC(dEnd.getUTCFullYear(), dEnd.getUTCMonth() + 1, 0));

            } else if (sPer === "Q") {
                const qStartMonth = Math.floor(dStart.getUTCMonth() / 3) * 3;
                dStart = new Date(Date.UTC(dStart.getUTCFullYear(), qStartMonth, 1));
                const qEndMonth = Math.floor(dEnd.getUTCMonth() / 3) * 3 + 2;
                dEnd = new Date(Date.UTC(dEnd.getUTCFullYear(), qEndMonth + 1, 0));
            }

            return { startDate: dStart, endDate: dEnd, period: sPer };
        },

        // =========================================================
        // 3. TREE TABLE SKELETON & HIGH-PERFORMANCE MAPPING
        // =========================================================
        _getEmptySkeleton() {
            const oEmptyWeeks = {};
            for (let i = 1; i <= 54; i++) { 
                oEmptyWeeks["W" + i] = 0; 
                oEmptyWeeks["W" + i + "_state"] = "None";
            }

            return [
                {
                    Category: "DEMAND", MRPElement: " ", BackendCategory: "1", BackendMRPElement: "XX", ...oEmptyWeeks,
                    nodes: [
                        { Category: "", MRPElement: "Planned Independent Req.", BackendCategory: "1", BackendMRPElement: "IndReq", ...oEmptyWeeks, nodes: [] },
                        { Category: "", MRPElement: "Sales Order", BackendCategory: "1", BackendMRPElement: "SalesOrders", ...oEmptyWeeks, nodes: [] },
                        { Category: "", MRPElement: "Component Requirements", BackendCategory: "1", BackendMRPElement: "DepReq", ...oEmptyWeeks, nodes: [] },
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
                    Category: "INVENTORY", MRPElement: "Stock Balance", BackendCategory: "3", BackendMRPElement: "Stock Balance", ...oEmptyWeeks, nodes: [] 
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
                                oLeaf["W" + i + "_state"] = "None";
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
                                        oLeaf["W" + i + "_state"] = "None";
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

            // ⭐ THE NEW FIX: Inventory Total = Inventory Base - Demand Total
            const oDemandNode = aTree.find(n => n.Category === "DEMAND");
            const oInvNode = aTree.find(n => n.Category === "INVENTORY");

            if (oDemandNode && oInvNode) {
                for (let i = 1; i <= 54; i++) {
                    let nInvBase = 0;
                    if (oInvNode.nodes && oInvNode.nodes.length > 0) {
                        nInvBase = oInvNode.nodes.reduce((sum, leaf) => sum + (Number(leaf["W" + i]) || 0), 0);
                    } else {
                        nInvBase = Number(oInvNode["W" + i]) || 0;
                    }
                    let nDemTotal = Number(oDemandNode["W" + i]) || 0;
                    oInvNode["W" + i] = Number((nInvBase - nDemTotal).toFixed(3));
                }
            }
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

        onMaterialVH(oEvent) { this._openAdvancedValueHelp(oEvent.getSource(), "Material", "Select Material", false); },
        onPlantVH(oEvent) { this._openAdvancedValueHelp(oEvent.getSource(), "Plant", "Define Plant Ranges", true); },
        onVendorVH(oEvent) { this._openAdvancedValueHelp(oEvent.getSource(), "Vendor", "Define Vendor Ranges", true); },

        _openAdvancedValueHelp(oInput, sField, sTitle, bIsMultiSelect) {
            const oValueHelpDialog = new ValueHelpDialog({
                title: sTitle, 
                supportMultiselect: bIsMultiSelect, 
                supportRanges: true, 
                supportRangesOnly: true, 
                key: sField, descriptionKey: sField,
                ok: function(oControlEvent) {
                    let aTokens = oControlEvent.getParameter("tokens");
                    
                    if (!bIsMultiSelect && aTokens.length > 1) {
                        MessageBox.information("MD04 Planning Rule:\n\nYou can only evaluate one Material at a time. Only your first selection has been applied.");
                        aTokens = [aTokens[0]]; 
                    }
                    
                    oInput.setTokens(aTokens); 
                    oValueHelpDialog.close();
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
            // ⭐ THE FIX: Wipe out any invisible, unsaved changes so they don't break the user after a Refresh!
            this._aChangeLog = []; 
            
            const oODataModel = this.getOwnerComponent().getModel();
            const aMatTokens = this.byId("inpMaterial").getTokens();
            const aPlantTokens = this.byId("inpPlant").getTokens();
            const aVendorTokens = this.byId("inpVendor").getTokens();
            
            const oAlignedDates = this._getAdjustedDates();

            if (!oAlignedDates || aPlantTokens.length === 0 || aMatTokens.length === 0) {
                return MessageBox.error("Mandatory fields missing: Plant, Material, and Horizon.");
            }

            const dStartDate = oAlignedDates.startDate;
            const dEndDate   = oAlignedDates.endDate;
            const sPer       = oAlignedDates.period;

            // ⭐ THE NEW FIX: Restrict Date Range to Maximum 1 Year (54 weeks)
            const iDaysDiff = (dEndDate.getTime() - dStartDate.getTime()) / (1000 * 3600 * 24);
            if (iDaysDiff > 378) {
                return MessageBox.error("The selected date range exceeds the maximum limit of 1 year (54 weeks). Please select a shorter horizon.");
            }

            this.onGenerateColumns(this._generateTimeBuckets(dStartDate, dEndDate, sPer));

            const aFilters = [];
            const oMatFilter = this._buildTokenFilters("Material", aMatTokens);
            if (oMatFilter) aFilters.push(oMatFilter);

            const oPlantFilter = this._buildTokenFilters("Plant", aPlantTokens);
            if (oPlantFilter) aFilters.push(oPlantFilter);
            
            const oVendorFilter = this._buildTokenFilters("Vendor", aVendorTokens);
            if (oVendorFilter) aFilters.push(oVendorFilter);

            // TIMEZONE FIX
            const dStartFilter = new Date(Date.UTC(dStartDate.getUTCFullYear(), dStartDate.getUTCMonth(), dStartDate.getUTCDate()));
            const dEndFilter = new Date(Date.UTC(dEndDate.getUTCFullYear(), dEndDate.getUTCMonth(), dEndDate.getUTCDate(), 23, 59, 59));

            aFilters.push(new Filter("AvailDate", FilterOperator.BT, dStartFilter, dEndFilter));
            aFilters.push(new Filter("Period", FilterOperator.EQ, sPer));

            this.getView().setBusy(true);
            
            const aAllResults = [];
            const fnFetchPage = (iSkip) => {
                oODataModel.read("/FlavorPlan", {
                    filters: aFilters,
                    urlParameters: { "$top": 1000, "$skip": iSkip }, 
                    success: (oData) => {
                        // ⭐ TIMEZONE FIX: Normalizer
                        if (oData && oData.results) {
                            oData.results.forEach(r => {
                                if (r.AvailDate) {
                                    r.AvailDate = new Date(r.AvailDate.getUTCFullYear(), r.AvailDate.getUTCMonth(), r.AvailDate.getUTCDate());
                                }
                            });
                        }

                        aAllResults.push(...oData.results);
                        
                        if (oData.results.length === 1000) {
                            fnFetchPage(iSkip + 1000);
                        } else {
                            this.getView().setBusy(false);
                            
                            if (aAllResults.length === 0) {
                                this.getView().getModel("localModel").setProperty("/RawData", []);
                                this.getView().getModel("localModel").setProperty("/GlobalUoM", "");
                                const aEmptyTree = this._getEmptySkeleton();
                                this.getView().getModel().setProperty("/mrpData", aEmptyTree);
                                this._oBackupModel.setProperty("/mrpData", JSON.parse(JSON.stringify(aEmptyTree)));
                                return MessageBox.information("No data for selection criteria.");
                            }

                            let oRowWithUoM = aAllResults.find(r => r.BaseUnit && r.BaseUnit !== "");
                            if (oRowWithUoM) {
                                this.getView().getModel("localModel").setProperty("/GlobalUoM", oRowWithUoM.BaseUnit);
                            }

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
            
            // TIMEZONE FIX
            const oFmtWk = DateFormat.getDateInstance({pattern: "MMM d, yyyy", UTC: true});
            const oFmtMon = DateFormat.getDateInstance({pattern: "MMMM yyyy", UTC: true});
            let iIdx = 1;

            while (dCur <= dEnd && iIdx <= 54) {
                let sLab = (sPeriod === "W") ? oFmtWk.format(dCur) : oFmtMon.format(dCur);
                if (sPeriod === "Q") sLab = "Q" + (Math.floor(dCur.getUTCMonth() / 3) + 1) + " " + dCur.getUTCFullYear();
                
                let dBucketEnd = new Date(dCur.getTime());
                
                if (sPeriod === "W") { dBucketEnd.setUTCDate(dBucketEnd.getUTCDate() + 6); } 
                else if (sPeriod === "M") { dBucketEnd.setUTCMonth(dBucketEnd.getUTCMonth() + 1); dBucketEnd.setUTCDate(0); } 
                else { dBucketEnd.setUTCMonth(dBucketEnd.getUTCMonth() + 3); dBucketEnd.setUTCDate(0); }

                aBuckets.push({ 
                    key: "W" + iIdx, 
                    label: sLab,
                    startDate: new Date(dCur.getTime()),
                    endDate: dBucketEnd 
                });
                
                if (sPeriod === "W") dCur.setUTCDate(dCur.getUTCDate() + 7);
                else if (sPeriod === "M") dCur.setUTCMonth(dCur.getUTCMonth() + 1);
                else dCur.setUTCMonth(dCur.getUTCMonth() + 3);
                iIdx++;
            }
            
            this.getView().getModel("localModel").setProperty("/TimeBuckets", aBuckets);
            return aBuckets;
        },

        onGenerateColumns(aBuckets) {
            const oTable = this.byId("idMrpTreeTable");
            const aCols = oTable.getColumns();
            
            for (let i = aCols.length - 1; i >= 4; i--) oTable.removeColumn(aCols[i]).destroy();

            // ⭐ THE NEW FIX: Hardcoded European/SAP GUI Format
            const oInputDecimalType = new TypeFloat({ 
                minFractionDigits: 3, 
                maxFractionDigits: 3, 
                groupingEnabled: true, 
                groupingSeparator: ".", 
                decimalSeparator: ",", 
                parseEmptyValueToZero: true 
            });
            const oDisplayDecimalType = new TypeFloat({ 
                minFractionDigits: 3, 
                maxFractionDigits: 3, 
                groupingEnabled: true, 
                groupingSeparator: ".", 
                decimalSeparator: ",", 
                parseEmptyValueToZero: true 
            });

            aBuckets.forEach(oBuck => {
                const oInp = new Input({
                    value: { path: oBuck.key, type: oInputDecimalType }, 
                    textAlign: "End",
                    valueState: { path: oBuck.key + '_state', formatter: (s) => s ? s : "None" },
                    valueStateText: "Unsaved Change",
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

                // ⭐ FEATURE: Dynamic Row Highlight on Focus
                oInp.attachBrowserEvent("focusin", function(e) {
                    let $tr = jQuery(e.target).closest("tr");
                    let sRowIndex = $tr.attr("data-sap-ui-rowindex");

                    let styleTag = document.getElementById("dynamic-row-highlight");
                    if (!styleTag) {
                        styleTag = document.createElement("style");
                        styleTag.id = "dynamic-row-highlight";
                        document.head.appendChild(styleTag);
                    }

                    if (sRowIndex !== undefined) {
                        styleTag.innerHTML = `
                            tr[data-sap-ui-rowindex="${sRowIndex}"] > td,
                            tr[data-sap-ui-rowindex="${sRowIndex}"] .sapUiTableCell {
                                background-color: rgba(150, 150, 150, 0.15) !important;
                            }
                            tr[data-sap-ui-rowindex="${sRowIndex}"] > td {
                                border-top: 1px solid rgba(150, 150, 150, 0.4) !important;
                                border-bottom: 1px solid rgba(150, 150, 150, 0.4) !important;
                            }
                        `;
                    }
                });

                oInp.attachBrowserEvent("focusout", function(e) {
                    let styleTag = document.getElementById("dynamic-row-highlight");
                    if (styleTag) styleTag.innerHTML = "";
                });

                // ⭐ BULLETPROOF HTML5 DRAG & DROP FIX ⭐
                oInp.addEventDelegate({ 
                    ondblclick: (e) => this.onCellDoubleClick(e.srcControl),
                    onAfterRendering: () => {
                        const dom = oInp.getDomRef();
                        if (dom && oInp.getEditable()) {
                            const innerInput = dom.querySelector("input") || dom;
                            
                            if (!innerInput.hasAttribute("data-dnd-bound")) {
                                innerInput.setAttribute("draggable", "true");
                                innerInput.setAttribute("data-dnd-bound", "true");
                                
                                innerInput.addEventListener("dragstart", (e) => {
                                    e.dataTransfer.setData("text/plain", oInp.getValue());
                                    e.dataTransfer.effectAllowed = "move";
                                    window._currentDragInput = oInp;
                                });
                                
                                innerInput.addEventListener("dragover", (e) => {
                                    if (oInp.getEditable()) {
                                        e.preventDefault(); 
                                        e.dataTransfer.dropEffect = "move";
                                        innerInput.style.backgroundColor = "#e5f0fa"; 
                                    }
                                });
                                
                                innerInput.addEventListener("dragleave", (e) => {
                                    innerInput.style.backgroundColor = ""; 
                                });
                                
                                innerInput.addEventListener("drop", (e) => {
                                    e.preventDefault();
                                    innerInput.style.backgroundColor = "";
                                    
                                    if (oInp.getEditable() && window._currentDragInput && window._currentDragInput !== oInp) {
                                        const sVal = e.dataTransfer.getData("text/plain");
                                        oInp.setValue(sVal);
                                        oInp.fireChange({ value: sVal }); 
                                        window._currentDragInput.setValue("0");
                                        window._currentDragInput.fireChange({ value: "0" });
                                        window._currentDragInput = null;
                                    }
                                });
                            }
                        }
                    }
                });

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
            
            let nVal = Number(oMod.getProperty(sPath + "/" + sWeek)) || 0; 
            let nCellOldQty = Number(this._oBackupModel.getProperty(sPath + "/" + sWeek)) || 0;

            const aRawData = this.getView().getModel("localModel").getProperty("/RawData");
            const aBuckets = this.getView().getModel("localModel").getProperty("/TimeBuckets");

            let oStartDate = null, oEndDate = null;
            if (aBuckets) {
                const oBucketDef = aBuckets.find(b => b.key === sWeek);
                if (oBucketDef) { oStartDate = oBucketDef.startDate; oEndDate = oBucketDef.endDate; }
            }

            let sMat = (oRow.Material || (this.byId("inpMaterial").getTokens()[0] ? this.byId("inpMaterial").getTokens()[0].getKey() : "")).trim();
            let sPlnt = (oRow.Plant || (this.byId("inpPlant").getTokens()[0] ? this.byId("inpPlant").getTokens()[0].getKey() : "")).trim();
            let sMrpElem = (oRow.BackendMRPElement || "IndReq").trim();
            let sProdVer = (oRow.ProdVersion || "").trim();

            let aMatches = [];
            if (aRawData) {
                aMatches = aRawData.filter(r => 
                    (r.Material || "").trim() === sMat && 
                    (r.Plant || "").trim() === sPlnt && 
                    (r.ProdVersion || "").trim() === sProdVer && 
                    (r.MRPElement || "").trim() === sMrpElem &&
                    Number(r[sWeek]) > 0 
                );
            }

            if (nVal !== nCellOldQty) {
                let bIsGlobalDistribution = false;
                let oEditedCells = new Set();
                let sCurrentCellKey = `${sMat}_${sPlnt}_${sMrpElem}_${sProdVer}_${sWeek}`;
                
                if (nCellOldQty > 0 || aMatches.length > 0) {
                    bIsGlobalDistribution = true;
                }
                
                let aAllActiveChanges = this._aChangeLog.filter(c => Number(c.NewQuantity) !== Number(c.OldQuantity));

                aAllActiveChanges.forEach(c => {
                    let sKey = `${(c.Material||"").trim()}_${(c.Plant||"").trim()}_${(c.MRPElement||"").trim()}_${(c.ProdVersion||"").trim()}_${c.PeriodBucket}`;
                    
                    if (sKey !== sCurrentCellKey) {
                        oEditedCells.add(sKey); 
                        if (Number(c.OldQuantity) > 0 || (c.PurchaseReq && c.PurchaseReq !== "")) {
                            bIsGlobalDistribution = true;
                        }
                    }
                });

                oEditedCells.add(sCurrentCellKey); 
                let iTotalEditedCells = oEditedCells.size;

                if (!bIsGlobalDistribution && iTotalEditedCells > 1) {
                    oInp.setValue(nCellOldQty); 
                    oMod.setProperty(sPath + "/" + sWeek, nCellOldQty); 
                    oMod.setProperty(sPath + "/" + sWeek + "_state", "None"); 
                    return MessageBox.warning("Information:\n\nYou are creating a new document. You can only modify 1 cell at a time.\n\nFirst save the highlighted (blue) cell before trying to make more changes.");
                }

                if (bIsGlobalDistribution && iTotalEditedCells > 2) {
                    oInp.setValue(nCellOldQty); 
                    oMod.setProperty(sPath + "/" + sWeek, nCellOldQty); 
                    oMod.setProperty(sPath + "/" + sWeek + "_state", "None"); 
                    return MessageBox.warning("Information:\n\nYou are moving an existing document. You can only modify a maximum of 2 cells at a time.\n\nFirst save the highlighted (blue) cells before making more changes.");
                }
            }

            // ⭐ FEATURE: Change state to Information (Blue) on edit, and add an asterisk for visibility
            if (nVal !== nCellOldQty) {
                oMod.setProperty(sPath + "/" + sWeek + "_state", "Information"); 
                if (oRow.MRPElement && !oRow.MRPElement.endsWith(" *")) {
                    oMod.setProperty(sPath + "/MRPElement", oRow.MRPElement + " *");
                }
            } else {
                oMod.setProperty(sPath + "/" + sWeek + "_state", "None"); 
                if (oRow.MRPElement && oRow.MRPElement.endsWith(" *")) {
                    oMod.setProperty(sPath + "/MRPElement", oRow.MRPElement.replace(" *", ""));
                }
            }

            const fnPushToLog = (oContext) => {
                const idx = this._aChangeLog.findIndex(c => 
                    (c.Material || "").trim() === (oContext.Material || "").trim() && 
                    (c.Plant || "").trim() === (oContext.Plant || "").trim() && 
                    (c.ProdVersion || "").trim() === (oContext.ProdVersion || "").trim() && 
                    (c.MRPElement || "").trim() === (oContext.MRPElement || "").trim() && 
                    c.PeriodBucket === oContext.PeriodBucket && 
                    c.PurchaseReq === oContext.PurchaseReq && c.LineItem === oContext.LineItem
                );
                if (idx !== -1) { this._aChangeLog[idx] = oContext; } else { this._aChangeLog.push(oContext); }
            };

            if (aMatches.length === 0) {
                fnPushToLog({ 
                    Material: sMat, Plant: sPlnt, Category: oRow.BackendCategory || "1", MRPElement: sMrpElem, 
                    ProdVersion: sProdVer, PeriodBucket: sWeek, NewQuantity: nVal, OldQuantity: nCellOldQty, 
                    PurchaseReq: "", LineItem: "", AvailDate: oStartDate, WkEndDate: oEndDate,
                    BindingPath: sPath 
                });
            } else {
                aMatches.forEach(oMatch => {
                    let nItemOldQty = Number(oMatch[sWeek]) || 0;
                    fnPushToLog({ 
                        Material: sMat, Plant: sPlnt, Category: oRow.BackendCategory, MRPElement: sMrpElem, 
                        ProdVersion: sProdVer, PeriodBucket: sWeek, NewQuantity: nVal, OldQuantity: nItemOldQty, 
                        PurchaseReq: oMatch.PurchaseReq || "", LineItem: oMatch.LineItem || "", 
                        AvailDate: oStartDate, WkEndDate: oEndDate,
                        BindingPath: sPath 
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

            // ⭐ THE NEW FIX: Dynamically update INVENTORY total (Inventory = Inventory - Demand)
            const aTreeData = oMod.getProperty("/mrpData");
            if (aTreeData) {
                const iInvIndex = aTreeData.findIndex(n => n.Category === "INVENTORY");
                const oDemNode = aTreeData.find(n => n.Category === "DEMAND");
                
                if (iInvIndex !== -1 && oDemNode) {
                    const oInvNode = aTreeData[iInvIndex];
                    let nBaseInv = 0;
                    if (oInvNode.nodes && oInvNode.nodes.length > 0) {
                        nBaseInv = oInvNode.nodes.reduce((sum, leaf) => sum + (Number(leaf[sWeek]) || 0), 0);
                    } else {
                        nBaseInv = Number(oInvNode[sWeek]) || 0;
                    }
                    let nDemTotal = Number(oDemNode[sWeek]) || 0;
                    oMod.setProperty("/mrpData/" + iInvIndex + "/" + sWeek, Number((nBaseInv - nDemTotal).toFixed(3)));
                }
            }
        },

        onCellDoubleClick(oInp) {
            const oCtx = oInp.getBindingContext();
            const oRow = oCtx.getProperty();
            const sWeek = oInp.data("weekProp");

            // ⭐ THE FIX: Do absolutely nothing when clicking an INVENTORY row
            if (oRow.Category === "INVENTORY" || oRow.BackendCategory === "3") {
                return; 
            }

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
                if (oTable) {
                    oTable.removeSelections(true); 
                    setTimeout(() => { oTable.selectAll(); }, 50);
                    
                    if (!oTable.data("deselectBlockedHook")) {
                        oTable.attachSelectionChange(function(e) {
                            if (!e.getParameter("selected")) {
                                oTable.selectAll();
                                sap.m.MessageToast.show("Partial selection is disabled. All documents must be processed together.");
                            }
                        });
                        oTable.data("deselectBlockedHook", true);
                    }
                }
                oPopover.openBy(oInput); 
            }.bind(this));
        },

        onConvertPrToPo: function () {
            const oTable = this.byId("idDocDetailsTable");
            const aSelectedContexts = oTable.getSelectedContexts();

            if (aSelectedContexts.length === 0) return MessageBox.warning("Please select at least one document to convert.");

            const aSelectedPRs = aSelectedContexts.map(oContext => oContext.getObject());
            const oOData = this.getOwnerComponent().getModel();
            
            oOData.setUseBatch(true); 
            oOData.setDeferredGroups(["convertGrp"]);

            // TIMEZONE FIX
            const fnToUTC = (d) => {
                if (!d) return null;
                return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
            };

            const oAlignedDates = this._getAdjustedDates();
            const dGlobalStart = oAlignedDates.startDate;
            const dGlobalEnd   = oAlignedDates.endDate;
            const sPer         = oAlignedDates.period;

            aSelectedPRs.forEach(pr => {
                // TIMEZONE FIX
                let sFormattedDate = pr.AvailDate ? sap.ui.core.format.DateFormat.getDateInstance({pattern: "yyyyMMdd", UTC: true}).format(pr.AvailDate) : "";
                
                const payload = { 
                    Material: pr.Material, Plant: pr.Plant, Category: pr.BackendCategory || "2", MRPElement: pr.BackendMRPElement, 
                    ProdVersion: pr.ProdVersion ? pr.ProdVersion : " ", PurchaseReq: pr.DocNumber, 
                    LineItem: pr.DocItem, ReqQuantity: pr.Quantity.toString(), BaseUnit: pr.UoM || "",
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
            const aActualChanges = this._aChangeLog.filter(c => Number(c.NewQuantity) !== Number(c.OldQuantity));

            if (aActualChanges.length === 0) {
                this._aChangeLog = []; 
                return MessageBox.information("No changes to save.");
            }

            const oOData = this.getOwnerComponent().getModel();
            oOData.setUseBatch(true); 
            oOData.setDeferredGroups(["grp"]);

            // TIMEZONE FIX
            const fnToUTC = (d) => {
                if (!d) return null;
                return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
            };

            const oAlignedDates = this._getAdjustedDates();
            const dGlobalStart = oAlignedDates.startDate;
            const dGlobalEnd   = oAlignedDates.endDate;
            const sPer         = oAlignedDates.period;

            aActualChanges.forEach(c => {
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
                    
                    let aMsgs = this._extractBatchErrors(oData, aActualChanges);
                    let bHasError = aMsgs.some(m => m.type === "error" || m.type === "E" || m.type === "error");
                    
                    const oMod = this.getView().getModel();

                    // ⭐ FEATURE: Red/Green state update on Save
                    aActualChanges.forEach(c => {
                        if (c.BindingPath) {
                            oMod.setProperty(c.BindingPath + "/" + c.PeriodBucket + "_state", bHasError ? "Error" : "Success");
                            
                            if (!bHasError) {
                                let sCurrentMRP = oMod.getProperty(c.BindingPath + "/MRPElement");
                                if (sCurrentMRP && sCurrentMRP.endsWith(" *")) {
                                    oMod.setProperty(c.BindingPath + "/MRPElement", sCurrentMRP.replace(" *", ""));
                                }
                            }
                        }
                    });
                    this.getView().getModel().refresh(true);

                    this._showAllMessages(aMsgs, "Save Operation", () => {
                        setTimeout(() => {
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
                        }, bHasError ? 0 : 800); 
                    });
                },
                error: (oError) => { 
                    this.getView().setBusy(false); 
                    let aMsgs = this._parseODataError(oError);
                    this._showAllMessages(aMsgs, "Save Failed");
                }
            });
        },

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
                    // 1. Handle Top-Level Batch Errors
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

                    // 2. Handle Individual ChangeSet Responses
                    if (res.__changeResponses) {
                        res.__changeResponses.forEach(changeRes => {
                            let oContext = (aContextArray && aContextArray[iChangeIndex]) ? aContextArray[iChangeIndex] : {};
                            let sPrefix = "";
                            
                            // ⭐ THE FIX: Dynamic Prefix based on Document Type
                            let sDocTypeLabel = "Doc";
                            let sMrpElem = oContext.MRPElement || oContext.BackendMRPElement || "";
                            
                            if (sMrpElem.includes("PurRqs")) sDocTypeLabel = "PR";
                            else if (sMrpElem.includes("PurOrd")) sDocTypeLabel = "PO";
                            else if (sMrpElem.includes("SalesOrders")) sDocTypeLabel = "SO";
                            else if (sMrpElem.includes("IndReq")) sDocTypeLabel = "PIR";
                            else if (sMrpElem.includes("STOs")) sDocTypeLabel = "STO";
                            else if (sMrpElem.includes("TransferRequirement")) sDocTypeLabel = "TR";
                            
                            let sActualDocNum = oContext.DocNumber || oContext.PurchaseReq || "";

                            if (sActualDocNum) {
                                sPrefix = `[${sDocTypeLabel} ${sActualDocNum}]: `;
                            } else if (oContext.Material) {
                                sPrefix = `[Mat ${oContext.Material} - ${oContext.PeriodBucket || oContext.Plant}]: `;
                            }

                            // Parse SAP-Message Header
                            if (changeRes.headers && changeRes.headers["sap-message"]) {
                                this._parseSapMessageHeader(changeRes.headers["sap-message"], aMsgs, sPrefix);
                            }
                            
                            // Parse OData Error Body
                            if (changeRes.response && changeRes.response.body) {
                                try {
                                    let oBody = JSON.parse(changeRes.response.body);
                                    if (oBody.error && oBody.error.message) {
                                        let sErrMsg = oBody.error.message;
                                        if (typeof sErrMsg === "object" && sErrMsg.value) sErrMsg = sErrMsg.value;
                                        aMsgs.push({ type: "error", message: sPrefix + sErrMsg });
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