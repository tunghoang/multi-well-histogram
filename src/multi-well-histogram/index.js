var componentName = 'multiWellHistogram';
module.exports.name = componentName;
require('./style.less');

const _DECIMAL_LEN = 4;

var app = angular.module(componentName, [
    'sideBar', 'wiTreeView', 'wiTableView',
    'wiApi', 'editable', 'wiDialog',
    'wiDroppable', 'wiDropdownList','plot-toolkit','wiLoading','angularResizable','wiDiscriminator'
]);
app.component(componentName, {
    template: require('./template.html'),
    controller: multiWellHistogramController,
    controllerAs: 'self',
    bindings: {
        token: "<",
        idProject: "<",
        wellSpec: "<",
        zonesetName: "<",
        selectionType: "=",
        selectionValue: "=",
        idHistogram: "<",
        config: '<',
        onSave: '<',
        onSaveAs: '<',
        title: '<',
        silent: "<", 
        ctrlParams: "<"
    },
    transclude: true
});

function multiWellHistogramController($scope, $timeout, $element, wiToken, wiApi, wiDialog, wiLoading) {
    let self = this;
    self.silent = true;
    self.treeConfig = [];
    self.selectedNode = null;
    self.datasets = {};
    self.statisticHeaders = ['top','bottom','points','avg','min', 'max', 'avgdev', 'stddev', 'var', 'skew', 'kurtosis', 'median', 'p10', 'p50', 'p90'];
    self.statisticHeaderMasks = [true,true,true,true,true,true,true,true,true,true,true,true,true,true,true];
    //--------------
    $scope.tab = 1;
    self.selectionTab = self.selectionTab || 'Wells';

    $scope.setTab = function(newTab){
        $scope.tab = newTab;
    };

    $scope.isSet = function(tabNum){
        return $scope.tab === tabNum;
    };
    this.getFamilyTable = () => wiApi.getFamilyTable()
    this.discriminatorDialog = function(well) {
        let wSpec = getWellSpec(well);
        let datasetId = wSpec.idDataset;
        let dataset = well.datasets.find(ds => ds.idDataset === wSpec.idDataset);

        let curvesArr = dataset.curves.map( c => ({type:'curve',name:c.name}) );
        wiDialog.discriminator(wSpec.discriminator, curvesArr, function(discrmnt) {
            wSpec.discriminator = discrmnt;
        });
    }
    this.hasDiscriminator = function(well) {
        let wSpec = getWellSpec(well);
        return wSpec.discriminator && Object.keys(wSpec.discriminator).length > 0 && wSpec.discriminator.active;
    }
    //--------------
    this.getDataset = function(well) {
        wiApi.getCachedWellPromise(well.idWell).then((well) => {
            self.datasets[well] = well.datasets;
        }).catch(e => console.error(e));
    }

    function getCurvesInWell(well) {
        let curves = [];
        well.datasets.forEach(dataset => {
            curves.push(...dataset.curves);
        });
        return curves;
    }

    function getFamilyInWell(well) {
        let curves = getCurvesInWell(well);
        let familyList = curves.map(c => wiApi.getFamily(c.idFamily));
        return familyList;
    }
    this.$onInit = async function () {
        if (self.token)
            wiToken.setToken(self.token);
        $timeout(() => {
            $scope.$watch(() => (self.wellSpec.map(wsp => wsp.idWell)), () => {
                getTree();
            }, true);
            $scope.$watch(() => (self.selectionType), () => {
                getSelectionList(self.selectionType, self.treeConfig);
                updateDefaultConfig();
            });
            $scope.$watch(() => (self.selectionValue), () => {
                updateDefaultConfig();
            });
            $scope.$watch(() => (self.treeConfig.map(w => w.idWell)), () => {
                getSelectionList(self.selectionType, self.treeConfig);
                getZonesetsFromWells(self.treeConfig);
                updateDefaultConfig();
            }, true);
            // $scope.$watch(() => (
            //     `${self.getLeft()}-${self.getRight()}-${self.getLoga()}-${self.getDivisions()}-${self.selectionValue}`
            // ), () => {
            //     _histogramGen = null;
            // });
        }, 500);

        self.defaultConfig = self.defaultConfig || {};
        self.wellSpec = self.wellSpec || [];
        self.selectionType = self.selectionType || 'family-group';
        self.zoneTree = [];
        self.zonesetName = self.zonesetName || "ZonationAll";
        self.config = self.config || {grid:true, displayMode: 'bar', colorMode: 'zone', stackMode: 'well', binGap: 5, title: self.title || ''};
        self.gaussianLine = self.gaussianLine || undefined;
        self.getToggleGaussianFn = self.getNotUsedGaussian() ? self.click2ToggleLogNormalD : self.click2ToggleGaussian;
    }

    this.onInputSelectionChanged = function(selectedItemProps) {
        self.selectionValue = (selectedItemProps || {}).name;
    }

    function getSelectionList(selectionType, wellArray) {
        let selectionHash = {};
        let allCurves = [];
        wellArray.forEach(well => {
            let curvesInWell = getCurvesInWell(well);
            allCurves.push(...curvesInWell);
        });
        switch(selectionType) {
            case 'curve':
                allCurves.forEach(curve => {
                    selectionHash[curve.name] = 1;
                })
                break;
            case 'family': 
                allCurves.forEach(curve => {
                    let family = wiApi.getFamily(curve.idFamily);
                    if(family)
                        selectionHash[family.name] = 1;
                })
                break;
            case 'family-group':
                allCurves.forEach(curve => {
                    let family = wiApi.getFamily(curve.idFamily);
                    if(family)
                        selectionHash[family.familyGroup] = 1;
                })
                break;
        }
        self.selectionList = Object.keys(selectionHash).map(item => ({ 
            data:{label:item}, 
            properties:{name:item} 
        }));
    }

    this.runMatch = function (node, criteria) {
        let family;
        if (!criteria) return true;
        switch(self.selectionType) {
            case 'family-group': 
                family = wiApi.getFamily(node.idFamily);
                if (!family) return null;
                return family.familyGroup.trim().toLowerCase() === criteria.trim().toLowerCase();

            case 'family': 
                family = wiApi.getFamily(node.idFamily);
                if (!family) return null;
                return family.name.trim().toLowerCase() === criteria.trim().toLowerCase();

            case 'curve':
                return node.name.trim().toLowerCase() === criteria.trim().toLowerCase();
        }
    }
    this.getLabel = function (node) {
        return node.name;
    }
    this.getIcon = function (node) {
        if (node.idCurve) return 'curve-16x16';
        if (node.idDataset) return 'curve-data-16x16';
        if (node.idWell) return 'well-16x16';
    }
    this.getChildren = function (node) {
        if (node.idDataset) {
            return node.curves;
        }
        if (node.idWell) {
            return node.datasets;
        }
        return [];
    }
    this.clickFunction = clickFunction;
    function clickFunction($event, node, selectedObjs, treeRoot) {
        let wellSpec = self.wellSpec.find(wsp => wsp.idWell === treeRoot.idWell);
        wellSpec.idCurve = node.idCurve;
        wellSpec.idDataset = node.idDataset;
        wellSpec.curveName = node.Name;
    }
    this.refresh = function(){
        // self.histogramList.length = 0;
        // self.treeConfig.length = 0;
        getTree(()=> {
            self.genHistogramList();
        });

    };
    async function getTree(callback) {
        wiLoading.show($element.find('.main')[0], self.silent);
        self.treeConfig = [];
        for (let w of self.wellSpec) {
            try {
                let well = await wiApi.getCachedWellPromise(w.idWell || w);
                self.treeConfig.push(well);
            }
            catch(e) {
                console.error(e);
            }
        }
        if (!$scope.$root.$$phase) $scope.$digest();

        callback && callback();
        wiLoading.hide();
        // for (let w of self.wellSpec) {
        //     promises.push(
        //         wiApi.getWellPromise(w.idWell || w)
        //             .then(well => ($timeout(() => self.treeConfig.push(well))))
        //     );
        // }
        /*Promise.all(promises)
            .then(() => callback && callback())
            .catch(e => console.error(e))
            .finally(() => wiLoading.hide());
            */
    }
    function getZonesetsFromWells(wells) {
        let zsList;
        for (let well of wells) {
            let zonesets = well.zone_sets;
            if (!zsList) {
                zsList = angular.copy(zonesets);
            }
            else if (zsList.length) {
                zsList = intersectAndMerge(zsList, zonesets);
            }
            else {
                break;
            }
        }
        self.zonesetList = (zsList || []).map( zs => ({
            data: {
                label: zs.name
            },
            properties: zs
        }));
        self.zonesetList.splice(0, 0, {data: {label: 'ZonationAll'}, properties: genZonationAllZS(0, 1)});
    }
    function intersectAndMerge(dstZoneList, srcZoneList) {
        return dstZoneList.filter(zs => {
            let zoneset = srcZoneList.find(zs1 => zs.name === zs1.name);
            if (!zoneset) return false;
            for (let z of zoneset.zones) {
                let zone = zs.zones.find(zo => zo.zone_template.name == z.zone_template.name);
                if (!zone) {
                    zs.zones.push(angular.copy(z));
                }
            }
            return true;
        });
    }
    this.getWellSpec = getWellSpec;
    function getWellSpec(well) {
        if (!well) return {};
        return self.wellSpec.find(wsp => wsp.idWell === well.idWell);
    }
    this.getCurve = getCurve;
    function getCurve(well) {
        let wellSpec = getWellSpec(well);
        if (!Object.keys(wellSpec).length) return {};
        let curves = getCurvesInWell(well).filter(c => self.runMatch(c, self.selectionValue));
        let curve = wellSpec.idCurve ? curves.find(c => c.idCurve === wellSpec.idCurve) : curves[0];
        if (!curve) {
            delete wellSpec.curveName;
            delete wellSpec.idCurve;
            delete wellSpec.idDataset;
            delete wellSpec.datasetName;
            delete wellSpec.datasetTop;
            delete wellSpec.datasetBottom;
            delete wellSpec.datasetStep;
            return;
        }
        wellSpec.curveName = curve.name;
        wellSpec.idCurve = curve.idCurve;
        wellSpec.idDataset = curve.idDataset;

        let datasets = self.getChildren(well);
        let dataset = wellSpec.idDataset ? datasets.find(ds => ds.idDataset === wellSpec.idDataset):datasets[0];
        wellSpec.datasetName = dataset.name;
        wellSpec.datasetTop = parseFloat(dataset.top);
        wellSpec.datasetBottom = parseFloat(dataset.bottom);
        wellSpec.datasetStep = parseFloat(dataset.step);
        return curve;
    }
    function getZoneset(well, zonesetName = "") {
        let zonesets = well.zone_sets;
        if (zonesetName === "" || zonesetName === "ZonationAll") 
            return null;
        return zonesets.find(zs => zs.name === zonesetName);
    }
    this.onZonesetSelectionChanged = function(selectedItemProps) {
        self.zoneTree = (selectedItemProps || {}).zones;
        self.zonesetName = (selectedItemProps || {}).name || 'ZonationAll';
    }
    this.runZoneMatch = function (node, criteria) {
        let keySearch = criteria.toLowerCase();
        let searchArray = node.zone_template.name.toLowerCase();
        return searchArray.includes(keySearch);
    }
    this.getZoneLabel = function (node) {
        if(!node || !node.zone_template){
            return 'aaa';
        }
        return node.zone_template.name;
    }

    this.getZoneIcon = (node) => ( (node && !node._notUsed) ? 'zone-16x16': 'fa fa-ban' )
    const EMPTY_ARRAY = []
    this.noChildren = function (node) {
        return EMPTY_ARRAY;
    }
    this.click2ToggleZone = function ($event, node, selectedObjs) {
        node._notUsed = !node._notUsed;
        self.selectedZones = Object.values(selectedObjs).map(o => o.data);
    }
    this.click2ToggleLayer = function ($event, node, selectedObjs) {
        node._notUsed = !node._notUsed;
        //self.selectedLayers = Object.values(selectedObjs).map(o => o.data);
    }
    this.click2ToggleCumulative = function ($event, node, selectedObjs) {
        node._useCmlt = !node._useCmlt;
        self.setCumulativeData(self.histogramList);
    }
    this.click2ToggleGaussian = function ($event, node, selectedObjs) {
        node._useGssn = !node._useGssn;
        self.setGaussianData(self.histogramList);
    }
    this.click2ToggleLogNormalD = function ($event, node, selectedObjs) {
        node._useLogNormalD = !node._useLogNormalD;
        self.setLogNormalDFn(self.histogramList);
    }
    this.toggleGaussianLine = function(notUsedGaussian) {
        self.config.notUsedGaussian = notUsedGaussian;
        if (notUsedGaussian) {
            self.getToggleGaussianFn = self.click2ToggleLogNormalD;
        } else {
            self.getToggleGaussianFn = self.click2ToggleGaussian;
        }
    }

    this.runLayerMatch = function (node, criteria) {
        let keySearch = criteria.toLowerCase();
        let searchArray = node.name.toLowerCase();
        return searchArray.includes(keySearch);
    }
    let _layerTree = [];
    this.getLayerTree = function() {
        if(self.getStackMode() === 'all') {
            _layerTree[0] = self.histogramList;
            return _layerTree;
        }
        return self.histogramList;
    }
    this.getLayerLabel = (node) => node.name
    this.getLayerIcon = (node) => ( (node && !node._notUsed) ? 'layer-16x16': 'fa fa-eye-slash' )
    this.getLayerIcons = (node) => ( ["rectangle"] )
    this.getLayerIconStyle = (node) => ( {
        'background-color': node.color
    })
    this.getCumulativeIcon = (node) => ( (node && node._useCmlt) ? 'layer-16x16': 'fa fa-eye-slash' )
    this.getCumulativeIcons = (node) => ( ["rectangle"] )
    this.getCumulativeIconStyle = (node) => ( {
        'background-color': node.color
    })
    this.getGaussianIcon = (node) => ( (node && node._useGssn) ? 'layer-16x16': 'fa fa-eye-slash' )
    this.getGaussianIcons = (node) => ( ["rectangle"] )
    this.getGaussianIconStyle = (node) => ( {
        'background-color': node.color
    } )
    this.getConfigLeft = function() {
        self.config = self.config || {};
        return isNaN(self.config.left) ? "[empty]": wiApi.bestNumberFormat(self.config.left, 3);
    }
    this.getConfigLimitTop = function () {
        self.config = self.config || {};
        return isNaN(self.config.limitTop) ? "[empty]": wiApi.bestNumberFormat(self.config.limitTop, 3);
    }
    this.getConfigLimitBottom = function () {
        self.config = self.config || {};
        return isNaN(self.config.limitBottom) ? "[empty]": wiApi.bestNumberFormat(self.config.limitBottom, 3);
    }
    this.setConfigLimitTop = function (notUse, newValue) {
        self.config.limitTop = parseFloat(newValue)
    }
    this.setConfigLimitBottom = function (notUse, newValue) {
        self.config.limitBottom = parseFloat(newValue)
    }
    this.setConfigLeft = function(notUse, newValue) {
        self.config.left = parseFloat(newValue);
    }
    this.getConfigRight = function() {
        self.config = self.config || {};
        return isNaN(self.config.right) ? "[empty]": wiApi.bestNumberFormat(self.config.right, 3);
    }
    this.setConfigRight = function(notUse, newValue) {
        self.config.right = parseFloat(newValue);
    }
    this.getConfigDivisions = function() {
        self.config = self.config || {};
        return isNaN(self.config.divisions) ? "[empty]": self.config.divisions;
    }
    this.setConfigDivisions = function(notUse, newValue) {
        self.config.divisions = parseInt(newValue);
    }
    this.getConfigTitle = function() {
        self.config = self.config || {};
        return (self.config.title || "").length ? self.config.title : "New Histogram";
    }
    this.setConfigTitle = function(notUse, newValue) {
        self.config.title = newValue;
    }
    this.getConfigXLabel = function() {
        self.config = self.config || {};
        return (self.config.xLabel || "").length ? self.config.xLabel : self.selectionValue;
    }
    this.setConfigXLabel = function(notUse, newValue) {
        self.config.xLabel = newValue;
    }
    function clearDefaultConfig() {
        self.defaultConfig = {};
    }
    function updateDefaultConfig() {
        clearDefaultConfig();
        let curve = getCurve(self.treeConfig[0], self.wellSpec[0]);
        if (!curve) return;
        let family = wiApi.getFamily(curve.idFamily);
        if (!family) return;
        self.defaultConfig.left = family.family_spec[0].minScale;
        self.defaultConfig.right = family.family_spec[0].maxScale;
        self.defaultConfig.loga = family.family_spec[0].displayType.toLowerCase() === 'logarithmic';
    }

    this.histogramList = [];
    var flattenHistogramList = [];
    var listWellStats = [];
    var listAllStats = [];
    this.genHistogramList = async function() {
        this.histogramList.length = 0;
        let allHistogramList = []
        listWellStats.length = 0;
        listAllStats.length = 0;
        _histogramGen = null;
        wiLoading.show($element.find('.main')[0], self.silent);

        let allZones = [];
        let allDataArray = [];
        let zoneBinsList = [];
        try {
            for (let i = 0; i < self.treeConfig.length; i++) {
                let well = self.treeConfig[i];
                if (well._notUsed) {
                    continue;
                }
                let curve = getCurve(well, self.wellSpec[i]);
                if (!curve) {
                    continue;
                }
                let datasetTop = self.wellSpec[i].datasetTop;
                let datasetBottom = self.wellSpec[i].datasetBottom;
                let datasetStep = self.wellSpec[i].datasetStep;
                let dataset = well.datasets.find(ds => ds.idDataset === self.wellSpec[i].idDataset);

                let zoneset = getZoneset(well, self.zonesetName);
                zoneset = zoneset || genZonationAllZS(datasetTop, datasetBottom, well.color);

                let curveData = await wiApi.getCachedCurveDataPromise(curve.idCurve);
                if (self.hasDiscriminator(well)) {
                    let discriminatorCurve = await wiApi.evalDiscriminatorPromise(dataset, self.wellSpec[i].discriminator);
                    curveData = curveData.filter((d, idx) => discriminatorCurve[idx]);
                }
                curveData = curveData
                    .filter(d => _.isFinite(d.x))
                    .map(d => ({
                        ...d, 
                        depth: datasetStep>0?(datasetTop + d.y * datasetStep):d.y
                    }));
                let zones = zoneset.zones.filter(zone => {
                    let z = self.zoneTree.find(z1 => {
                        return z1.zone_template.name === zone.zone_template.name
                    });
                    return !z._notUsed;
                });
                if (self.getStackMode() === 'all') {
                    allZones = [...allZones, ...zones];
                }
                let wellHistogramList = [];
                let wellDataArray = [];
                for (let j = 0; j < zones.length; j++) {
                    let zone = zones[j];
                    let dataArray = filterData(curveData, zone);
                    dataArray.top = zone.startDepth;
                    dataArray.bottom = zone.endDepth;
                    if (self.getStackMode() === 'well') {
                        wellDataArray = [...wellDataArray, ...dataArray];
                    } else if (self.getStackMode() === 'all') {
                        allDataArray = [...allDataArray, ...dataArray];
                    }
                    let bins = genBins(dataArray);
                    bins.color = self.getColor(zone, well);
                    bins.name = `${well.name}.${zone.zone_template.name}`;

                    bins.stats = {};
                    bins.stats.top = zone.startDepth;
                    bins.stats.bottom = zone.endDepth;
                    let stats = setStats(dataArray.map(d => d.x));
                    Object.assign(bins.stats, stats);
                    if (self.getStackMode() === 'zone') {
                        let zoneExisted = zoneBinsList.find(zbl => zbl.name == zone.zone_template.name);
                        let zoneBinsElem;
                        if (!zoneExisted) {
                            zoneBinsList.push([]);
                            zoneExisted = zoneBinsList[zoneBinsList.length - 1];
                            zoneExisted.name = zone.zone_template.name;
                            if (self.getColorMode() === 'zone') {
                                zoneExisted.color = self.getColor(zone, well);
                            } else {
                                zoneExisted.color = well.color;
                            }
                        }
                        if (!zoneExisted[i]) zoneExisted[i] = [];
                        zoneExisted[i] = bins;
                    }
                    wellHistogramList.push(bins);
                }
                if (self.getStackMode() === 'well') {
                    let stats = setStats(wellDataArray.map(d => d.x));
                    stats.top = d3.min(zones, z => z.startDepth);
                    stats.bottom = d3.max(zones, z => z.endDepth);
                    listWellStats.push(stats);
                    wellHistogramList.name = well.name;
                    wellHistogramList.color = well.color;
                    allHistogramList.push(wellHistogramList);
                } else allHistogramList.push(...wellHistogramList);
            }
            allHistogramList.name = 'All';
            let max = 0;
            let flatten = [];
            switch(self.getStackMode()) {
                case 'none':
                    for (let bins of allHistogramList) {
                        let maybeMax = d3.max(bins.map(b => b.length));
                        max = (max > maybeMax) ? max : maybeMax;
                    }
                    flatten = allHistogramList;
                    break;
                case 'well':
                    {
                        for (let groupOfBins of allHistogramList) {
                            let aggregate = aggregateHistogramList(groupOfBins);
                            let maybeMax = d3.max(aggregate);
                            max = (max > maybeMax) ? max : maybeMax;
                            flatten = flatten.concat(groupOfBins);
                        }
                    }
                    break;
                case 'zone':
                    {
                        for (let groupOfBins of zoneBinsList) {
                            let fullData = [];
                            for (let i = 0; i < groupOfBins.flat().length; i++) {
                                fullData = fullData.concat(groupOfBins.flat()[i]);
                            }
                            groupOfBins.stats = setStats(fullData);
                            groupOfBins.stats.top = _.min(groupOfBins.map(gob => gob.stats.top));
                            groupOfBins.stats.bottom = _.max(groupOfBins.map(gob => gob.stats.bottom));
                            let aggregate = aggregateHistogramList(groupOfBins);
                            let maybeMax = d3.max(aggregate);
                            max = (max > maybeMax) ? max : maybeMax;
                        }
                        allHistogramList = zoneBinsList;
                        flatten = zoneBinsList;
                    }
                    break;
                case 'all': 
                    {
                        let aggregate = aggregateHistogramList(allHistogramList);
                        max = d3.max(aggregate);
                        flatten = allHistogramList;

                        let stats = setStats(allDataArray.map(d => d.x));
                        stats.top = d3.min(allZones, z => z.startDepth);
                        stats.bottom = d3.max(allZones, z => z.endDepth);
                        listAllStats.push(stats);
                    }
                    break;

            }
            $timeout(() => {
                self.minY = 0;
                self.maxY = max;
                self.histogramList = allHistogramList;
                flattenHistogramList = flatten;
                self.setCumulativeData(self.histogramList);
                self.setGaussianData(self.histogramList);
            });
        }
        catch(e) {
            console.error(e);
        }
        wiLoading.hide();
        console.log('end');
    }
    function setStats(dataArray) {
        let stats = {};
        try {
            stats.numPoints = dataArray.length;
            stats.avg = d3.mean(dataArray);
            stats.min = d3.min(dataArray);
            stats.max = d3.max(dataArray);
            stats.stddev = d3.deviation(dataArray);
            stats.avgdev = calAverageDeviation(dataArray);
            stats.var = d3.variance(dataArray);
            stats.median = d3.median(dataArray);
            stats.skew = dataArray.length >= 3 ? ss.sampleSkewness(dataArray) : undefined;
            stats.kurtosis = dataArray.length >= 4 ? ss.sampleKurtosis(dataArray) : undefined;
            stats.p10 = calPercentile(dataArray, 0.1);
            stats.p50 = calPercentile(dataArray, 0.5);
            stats.p90 = calPercentile(dataArray, 0.9);
        }
        catch(e) {
            console.error(e);
        }
        return stats;
    }
    function calAverageDeviation(data) {
        if (data.length < 1) return;
        let mean = d3.mean(data);

        return d3.mean(data, function (d) {
            return Math.abs(d - mean)
        }).toFixed(_DECIMAL_LEN);
    }
    function calPercentile(data, p) {
        if (data.length < 1) return;
        return d3.quantile(data.sort(function (a, b) {
            return a - b;
        }), p).toFixed(_DECIMAL_LEN);
    }
    function aggregateHistogramList(histogramList) {
        let aggregate = [];
        for (let bins of histogramList) {
            for (let j = 0; j < bins.length; j++) {
                aggregate[j] = ((aggregate[j] || 0) + bins[j].length);
            }
        }
        return aggregate;
    }
    function genZonationAllZS(top, bottom, color = 'blue') {
        return {
            name: 'ZonationAll',
            zones: [{
                startDepth: top,
                endDepth: bottom,
                zone_template: {
                    name: 'ZonationAll',
                    background: color
                }
            }]
        }
    }
    this.genBins = genBins;
    function genBins(pointset) {
        let divisions = self.getDivisions();
        let loga = self.getLoga();
        let histogramGen = getHistogramFn(divisions, loga);
        return histogramGen(pointset.map(d => d.x));
    }
    var _histogramGen;
    function getHistogramFn(divisions, loga) {
        if (!_histogramGen) {
            let left = self.getLeft();
            let right = self.getRight();
            let divisions = self.getDivisions();
            let domain = d3.extent([left, right]);
            let thresholds;
            if (!loga) {
                thresholds = d3.range(domain[0], domain[1], (domain[1] - domain[0])/divisions);
            }
            else {
                let logMinVal = Math.log10(domain[0] || 0.01);
                let logMaxVal = Math.log10(domain[1] || 0.01);
                thresholds = d3.range(logMinVal, logMaxVal, (logMaxVal - logMinVal)/divisions).map(v => Math.pow(10, v)); 
            }
            _histogramGen = d3.histogram().domain(domain).thresholds(thresholds);
        }
        return _histogramGen;
    }
    function filterData(curveData, zone) {
        return curveData.filter(d => ((zone.startDepth - d.depth)*(zone.endDepth - d.depth) <= 0));
    }
    function getCorrectValue(val1, val2) {
        return _.isFinite(val1) ? val1 : val2;

    }
    this.getLeft = () => {
        if(self.config.flipHorizontal) {
            return getCorrectValue(getCorrectValue(self.config.right, self.defaultConfig.right), 1) ;
        }
        return getCorrectValue(getCorrectValue(self.config.left, self.defaultConfig.left), 0) ;
    }
    this.getRight = () => {
        if(self.config.flipHorizontal) {
            return getCorrectValue(getCorrectValue(self.config.left, self.defaultConfig.left), 1) ;
        }
        return getCorrectValue(getCorrectValue(self.config.right, self.defaultConfig.right), 0) ;
    } 
    this.getLoga = () => (self.config.loga || self.defaultConfig.loga || 0)
    this.getNotUsedGaussian = () => {self.config.notUsedGaussian || false};
    this.getDivisions = () => (self.config.divisions || self.defaultConfig.divisions || 35)
    this.getColorMode = () => (self.config.colorMode || self.defaultConfig.colorMode || 'zone')
    this.getColor = (zone, well) => {
        let cMode = self.getColorMode();
        return cMode === 'zone' ? zone.zone_template.background:(cMode === 'well'?well.color:'blue');
    }
    this.getDisplayMode = () => (self.config.displayMode || self.defaultConfig.displayMode || 'bar')
    this.getStackMode = () => (self.config.stackMode || self.defaultConfig.stackMode || 'none')
    this.getBinGap = () => (self.config.binGap || self.defaultConfig.binGap)
    this.getBinX = (bin) => ((bin.x0 + bin.x1)/2)
    this.getBinY = (bin) => (bin.length)

    this.colorFn = function(bin, bins) {
        if (self.getStackMode() === 'none');
        return bins.color;
    }

    this.save = function() {
        console.log('save');
        if (!self.idHistogram) {
            wiDialog.promptDialog({
                title: 'New Histogram',
                inputName: 'Histogram Name',
                input: self.getConfigTitle(),
            }, function(name) {
                let type = 'HISTOGRAM';
                self.setConfigTitle(null, name);
                let content = {
                    wellSpec: self.wellSpec,
                    zonesetName: self.zonesetName,
                    selectionType: self.selectionType,
                    selectionValue: self.selectionValue,
                    config: self.config	
                }
                wiApi.newAssetPromise(self.idProject, name, type, content).then(res => {
                    self.idHistogram = res.idParameterSet;
                    self.onSave && self.onSave(res);
                })
                    .catch(e => {
                        console.error(e);
                        self.save();
                    })
            });
        }
        else {
            let type = 'HISTOGRAM';
            let content = {
                idParameterSet: self.idHistogram,
                wellSpec: self.wellSpec,
                zonesetName: self.zonesetName,
                selectionType: self.selectionType,
                selectionValue: self.selectionValue,
                config: self.config	
            }
            wiApi.editAssetPromise(self.idHistogram, content).then(res => {
                console.log(res);
            })
                .catch(e => {
                    console.error(e);
                });
        }
    }
    this.saveAs = function() {
        console.log("saveAs");
        wiDialog.promptDialog({
            title: 'Save As Histogram',
            inputName: 'Histogram Name',
            input: '',
        }, function(name) {
            let type = 'HISTOGRAM';
            let content = {
                wellSpec: self.wellSpec,
                zonesetName: self.zonesetName,
                selectionType: self.selectionType,
                selectionValue: self.selectionValue,
                config: {...self.config, title: name} 
            }
            wiApi.newAssetPromise(self.idProject, name, type, content).then(res => {
                self.idHistogram = res.idParameterSet;
                console.log(res);
                self.onSaveAs && self.onSaveAs(res);
            })
                .catch(e => {
                    console.error(e);
                    self.saveAs();
                })
        });
    }

    let _zoneNames = []
    self.getZoneNames = function() {
        _zoneNames.length = 0;
        Object.assign(_zoneNames, self.histogramList.map(bins => bins.name));
        return _zoneNames;
    }
    self.getStatsRowIcons = function(rowIdx) {
        return ['rectangle'];
    }
    self.getStatsIconStyle = function(rowIdx) {
        return {
            'background-color': self.histogramList[rowIdx].color
        }
    }
    self.statsValue = function ([row, col]) {
        let statsArray = [];
        switch(self.getStackMode()) {
            case 'none':
                statsArray = flattenHistogramList.map(e => e.stats);
                break;
            case 'well':
                statsArray = [...listWellStats];
                break;
            case 'zone':
                statsArray = flattenHistogramList.map(e => e.stats);
                break;
            case 'all':
                // statsArray = [...listAllStats];
                statsArray = flattenHistogramList.map(e => e.stats);
                break;
            default:
                statsArray = [];
        }

        try {
            switch(_headers[col]){
                case 'top': 
                    return wiApi.bestNumberFormat(statsArray[row].top, 4) || 'N/A';
                case 'bottom': 
                    return wiApi.bestNumberFormat(statsArray[row].bottom, 4) || 'N/A';
                case 'points':
                    return statsArray[row].numPoints || 'N/A';
                case 'avg':
                    return wiApi.bestNumberFormat(statsArray[row].avg) || 'N/A'
                case 'min':
                    return wiApi.bestNumberFormat(statsArray[row].min) || 'N/A'
                case 'max':
                    return wiApi.bestNumberFormat(statsArray[row].max )|| 'N/A'
                case 'avgdev': 
                    return wiApi.bestNumberFormat(statsArray[row].avgdev) || 'N/A';
                case 'stddev': 
                    return wiApi.bestNumberFormat(statsArray[row].stddev) || 'N/A';
                case 'var':
                    return wiApi.bestNumberFormat(statsArray[row].var) || 'N/A';
                case 'skew':
                    return wiApi.bestNumberFormat(statsArray[row].skew) || 'N/A';
                case 'kurtosis':
                    return wiApi.bestNumberFormat(statsArray[row].kurtosis) || 'N/A';
                case 'median':
                    return wiApi.bestNumberFormat(statsArray[row].median) || 'N/A';
                case 'p10': 
                    return wiApi.bestNumberFormat(statsArray[row].p10) || 'N/A';
                case 'p50': 
                    return wiApi.bestNumberFormat(statsArray[row].p50) || 'N/A';
                case 'p90': 
                    return wiApi.bestNumberFormat(statsArray[row].p90) || 'N/A';
                default: 
                    return "this default";
            }
        } catch {
            return 'N/A';
        }
    }
    let _headers = [];
    self.getHeaders = function (){
        _headers.length = 0;
        Object.assign(_headers, self.statisticHeaders.filter((item, idx) => self.statisticHeaderMasks[idx]));
        return _headers;
    }
    this.hideSelectedLayer = function() {
        if(!self.selectedLayers) return;
        self.selectedLayers.forEach(layer => layer._notUsed = true);
    }
    this.showSelectedLayer = function() {
        if(!self.selectedLayers) return;
        self.selectedLayers.forEach(layer => layer._notUsed = false);
        $timeout(() => {});
    }
    this.hideAllLayer = function() {
        self.histogramList.forEach(bins => bins._notUsed = true);
        $timeout(() => {});
    }
    this.showAllLayer = function() {
        self.histogramList.forEach(bins => bins._notUsed = false);
        $timeout(() => {});
    }

    //--------------

    this.hideSelectedZone = function() {
        if(!self.selectedZones) return;
        self.selectedZones.forEach(layer => layer._notUsed = true);
    }
    this.showSelectedZone = function() {
        if(!self.selectedZones) return;
        self.selectedZones.forEach(layer => layer._notUsed = false);
        $timeout(() => {});
    }
    this.hideAllZone = function() {
        self.zoneTree.forEach(bins => bins._notUsed = true);
        $timeout(() => {});
    }
    this.showAllZone = function() {
        self.zoneTree.forEach(bins => bins._notUsed = false);
        $timeout(() => {});
    }
    this.onDrop = function (event, helper, myData) {
        let idWells = helper.data('idWells');
        if (idWells && idWells.length) {
            $timeout(() => {
                for (let idWell of idWells) {
                    if (!self.wellSpec.find(wsp => wsp.idWell === idWell)) {
                        self.wellSpec.push({idWell});
                    }
                }
            })
        }
    }
    this.toggleWell = function(well) {
        well._notUsed = !well._notUsed;
    }
    this.removeWell = function(well) {
        let index = self.wellSpec.findIndex(wsp => wsp.idWell === well.idWell);
        if(index >= 0) {
            self.wellSpec.splice(index, 1);
        }
    }

    self.cmltLineData = [];
    this.setCumulativeData = function(layers) {
        self.cmltLineData.length = 0;
        if (self.getStackMode() != 'all') {
            layers = layers.filter(l => l._useCmlt);
        } else if (!layers._useCmlt) {
            return;
        }
        if (!layers.length) return;
        if (self.getStackMode() === 'well' ||
            self.getStackMode() === 'zone') layers = layers.flat();
        let newData = [];
        for (let i = 0; i < self.getDivisions(); i++) {
            let elem = [];
            for (let j = 0; j < layers.length; j++) {
                elem = [...elem, ...layers[j][i]];
                elem.x0 = layers[j][i].x0;
                elem.x1 = layers[j][i].x1;
            }
            newData.push(elem);
        }
        newData.totalPoint = _.sum(newData.map(d => d.length));
        let cumulativeVal = 0;
        newData.forEach(l => {
            cumulativeVal += l.length;
            self.cmltLineData.push({
                x: (l.x0 + l.x1) / 2,
                y: (cumulativeVal / newData.totalPoint) * self.maxY
            });
            self.cmltLineData.color = self.cmltLineData.color || colorGenerator();
            self.cmltLineData.width = self.cmltLineData.width || 2;
        })
    }
    this.setGaussianData = function(layers) {
        self.gaussianLine = self.gaussianLine || {};
        if (self.getStackMode() != 'all') {
            layers = layers.filter(l => l._useGssn);
        } else if (!layers._useGssn) {
            return;
        }
        if (!layers.length) {
            self.gaussianLine._notUsed = true;
            return;
        }
        self.gaussianLine._notUsed = false;
        if (self.getStackMode() === 'well' ||
            self.getStackMode() === 'zone') layers = layers.flat();
        let fullData = [];
        for (let lIdx = 0; lIdx < layers.length; lIdx++) {
            for (let bIdx = 0; bIdx < layers[lIdx].length; bIdx++) {
                fullData = fullData.concat(layers[lIdx][bIdx]);
            }
        }
        let mean = d3.mean(fullData);
        let sigma = d3.deviation(fullData);
        self.gaussianLine = {
            ...self.gaussianLine,
            mean, sigma,
            width: 2,
        }
        self.gaussianLine.fn = (function(x) {
            let mean = this.mean;
            let sigma = this.sigma;
            let gaussianConstant = 1 / Math.sqrt(2 * Math.PI);
            x = (x - mean) / sigma;
            return gaussianConstant * Math.exp(-.5 * x * x) / sigma;
        }).bind(self.gaussianLine);
        self.gaussianLine.color = self.gaussianLine.color || colorGenerator();
        self.gaussianLine.sigmaLines = [
            {color: self.gaussianLine.color, value: mean - sigma},
            {color: self.gaussianLine.color, value: mean + sigma}
        ]
    }
    this.setLogNormalDFn = function(layers) {
        self.logNormalDLine = self.logNormalDLine || {};
        if (self.getStackMode() != 'all') {
            layers = layers.filter(l => l._useLogNormalD);
        } else if (!layers._useLogNormalD) {
            return;
        }
        if (!layers.length) {
            self.logNormalDLine._notUsed = true;
            return;
        }
        self.logNormalDLine._notUsed = false;
        if (self.getStackMode() === 'well' ||
            self.getStackMode() === 'zone') layers = layers.flat();
        let fullData = [];
        for (let lIdx = 0; lIdx < layers.length; lIdx++) {
            for (let bIdx = 0; bIdx < layers[lIdx].length; bIdx++) {
                fullData = fullData.concat(layers[lIdx][bIdx]);
            }
        }
        let mean = d3.mean(fullData);
        let sigma = d3.deviation(fullData);
        self.logNormalDLine = {
            ...self.logNormalDLine,
            mean, sigma,
            width: 2
        }
        self.logNormalDLine.fn = (function(x) {
            if (x <= 0) return 0;
            let mean = this.mean,
                sigma = this.sigma,
                s2 = Math.pow(sigma, 2),
                A = 1 / (Math.sqrt(2 * Math.PI)),
                B = -1 / (2 * s2);
            return (1 / (x * sigma)) * A * Math.exp(B * Math.pow(Math.log(x) - mean, 2));
        }).bind(self.logNormalDLine);
        self.logNormalDLine.color = self.logNormalDLine.color || colorGenerator();
    }
    this.getCumulativeX = cmlt => {
        return cmlt.x;
    };
    this.getCumulativeY = cmlt => {
        return cmlt.y;
    }

    function colorGenerator() {
        let rand = function () {
            return Math.floor(Math.random() * 255);
        }
        return "rgb(" + rand() + "," + rand() + "," + rand() + ")";
    }

    this.getMarkerVal = (marker, idx) => (marker.value)
    this.setMarkerVal = (marker, idx, newVal) => {marker.value = newVal;}
    this.markerStyle = (marker, idx) => ({stroke:marker.color,'stroke-width':'2', fill:'none'})
    this.markerName = (marker, idx) => (marker.name)
}
