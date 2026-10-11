let numericData = [];
let rawNumericData = [];
let labels = [];
let features = null;
let disabledFeatures = new Set();
let disabledRowIndices = new Set();
let detectedOutlierIndices = new Set();
let transformMode = 'std'; // 'std', 'log', 'robust', 'none'
let missingMode = 'drop'; // 'drop', 'mean', 'median'
let clusterSpace = 'all'; // 'all', 'pc'
let clusterMethod = 'kmeans'; // 'kmeans', 'dbscan'
let dbscanEps = 1.0;
let dbscanMinPts = 3;
let splomMaxVars = 'all'; // '8', '10', '12', '15', 'all'
let corrMethod = 'pearson'; // 'pearson', 'spearman'
let pcaResult = null;
let currentScale = 1.0;

let currentRelView = 'heatmap';

// 軸トラッキング（スマートスワップ用）
let prevAxisX = "0";
let prevAxisY = "1";
let prevAxisZ = "2";

function getActiveFeatures() {
    if (!features) return [];
    return features.filter(f => !disabledFeatures.has(f));
}

function getActiveLabels() {
    if (!labels) return [];
    return getActiveRowIndices().map(i => labels[i]);
}

function getActiveNumericData() {
    if (!numericData || numericData.length === 0) return [];
    const activeColIndices = [];
    features.forEach((f, idx) => {
        if (!disabledFeatures.has(f)) activeColIndices.push(idx);
    });
    
    const activeData = [];
    getActiveRowIndices().forEach(rIdx => {
        activeData.push(activeColIndices.map(cIdx => numericData[rIdx][cIdx]));
    });
    return activeData;
}

function getActiveRowIndices() {
    const indices = [];
    if (labels && rawNumericData && rawNumericData.length > 0) {
        const activeColIndices = [];
        features.forEach((f, idx) => {
            if (!disabledFeatures.has(f)) activeColIndices.push(idx);
        });
        
        labels.forEach((_, i) => {
            if (!disabledRowIndices.has(i)) {
                if (missingMode === 'drop') {
                    let hasMissing = false;
                    for (const cIdx of activeColIndices) {
                        const val = rawNumericData[i][cIdx];
                        if (isNaN(val) || val === null) {
                            hasMissing = true;
                            break;
                        }
                    }
                    if (!hasMissing) {
                        indices.push(i);
                    }
                } else {
                    // mean または median モードでは補完されるため行は除外されない
                    indices.push(i);
                }
            }
        });
    }
    return indices;
}

// DOM Elements
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const dataPreview = document.getElementById('data-preview');
const previewTable = document.getElementById('preview-table');
const btnRunPca = document.getElementById('btn-run-pca');
const resultsSection = document.getElementById('results-section');
const uploadSection = document.getElementById('upload-section');
const axisXSelect = document.getElementById('axis-x-select');
const axisYSelect = document.getElementById('axis-y-select');
const axisZSelect = document.getElementById('axis-z-select');
const zAxisGroup = document.getElementById('z-axis-group');
const enable3dCheck = document.getElementById('enable-3d');
const plotTitleInput = document.getElementById('plot-title');
const vectorScale = document.getElementById('vector-scale');
const vectorScaleVal = document.getElementById('vector-scale-val');
const clusterCount = document.getElementById('cluster-count');
const summaryText = document.getElementById('summary-text');
const btnDownloadCsv = document.getElementById('btn-download-csv');
const btnDownloadPng = document.getElementById('btn-download-png');
const btnReset = document.getElementById('btn-reset');
const btnBackToData = document.getElementById('btn-back-to-data');
const btnUseSample = document.getElementById('btn-use-sample');

// --- Window Drag & Drop Protection (Prevents Firefox file navigation) ---
window.addEventListener('dragover', (e) => e.preventDefault(), false);
window.addEventListener('drop', (e) => e.preventDefault(), false);

// --- File Drop & Selection Event Listeners ---

if (dropZone) {
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer && e.dataTransfer.files.length) {
            handleFile(e.dataTransfer.files[0]);
        }
    });
}

if (fileInput) {
    fileInput.addEventListener('change', (e) => {
        if (e.target && e.target.files && e.target.files.length) {
            handleFile(e.target.files[0]);
        }
    });
}

function loadSampleCsvFile(filePath) {
    fetch(filePath + '?v=' + Date.now())
        .then(res => {
            if (!res.ok) throw new Error("HTTP " + res.status + " " + res.statusText);
            return res.text();
        })
        .then(csvText => {
            const ext = filePath.split('.').pop().toLowerCase();
            parseTextWithAutoDelimiter(csvText, ext);
        })
        .catch(err => {
            console.error("fetch sample error:", err);
            alert("サンプルデータ（" + filePath + "）の読み込みに失敗しました。\n\n【ヒント】\nブラウザの直接ファイル参照（file://）ではブラウザのセキュリティ制限（CORS）によりfetchがブロックされる場合があります。\n付属の「./start_server.sh」を実行してローカルサーバー（http://localhost:8000）からアクセスするか、「data/」フォルダ内のCSVファイルを画面上のドロップゾーンにドラッグ＆ドロップしてください。");
        });
}

document.querySelectorAll('.btn-load-sample').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const filePath = e.currentTarget.dataset.file;
        if (filePath) {
            loadSampleCsvFile(filePath);
        }
    });
});

if (btnUseSample) {
    btnUseSample.addEventListener('click', () => {
        loadSampleCsvFile('data/noodle_data.csv');
    });
}

if (btnRunPca) btnRunPca.addEventListener('click', () => runPCA(false));

function getClusteringInputData(pcaRes = pcaResult) {
    if (!pcaRes) return [];
    if (clusterSpace === 'pc') {
        const is3D = document.getElementById('enable-3d') ? document.getElementById('enable-3d').checked : false;
        const xIdx = parseInt(axisXSelect ? axisXSelect.value : 0);
        const yIdx = parseInt(axisYSelect ? axisYSelect.value : 1);
        const zIdx = parseInt(axisZSelect ? axisZSelect.value : 2);
        if (is3D) {
            return pcaRes.scores.map(row => [row[xIdx], row[yIdx], row[zIdx]]);
        } else {
            return pcaRes.scores.map(row => [row[xIdx], row[yIdx]]);
        }
    }
    return pcaRes.X;
}

function euclideanDistance(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        const d = a[i] - b[i];
        sum += d * d;
    }
    return Math.sqrt(sum);
}

function runDBSCAN(data, eps, minPts) {
    const n = data.length;
    if (n === 0) return { labels: [], numClusters: 0, numNoise: 0 };
    
    const labels = new Array(n);
    const visited = new Array(n).fill(false);
    let clusterId = 0;
    
    const neighbors = [];
    for (let i = 0; i < n; i++) {
        const nb = [];
        for (let j = 0; j < n; j++) {
            if (euclideanDistance(data[i], data[j]) <= eps) {
                nb.push(j);
            }
        }
        neighbors.push(nb);
    }
    
    for (let i = 0; i < n; i++) {
        if (visited[i]) continue;
        visited[i] = true;
        
        if (neighbors[i].length < minPts) {
            labels[i] = -1; // ノイズ（外れ値）
            continue;
        }
        
        // 新規クラスタ開始
        labels[i] = clusterId;
        const seedSet = [...neighbors[i]];
        const seedIdx = seedSet.indexOf(i);
        if (seedIdx > -1) seedSet.splice(seedIdx, 1);
        
        let idx = 0;
        while (idx < seedSet.length) {
            const curr = seedSet[idx];
            idx++;
            
            if (labels[curr] === -1) {
                labels[curr] = clusterId; // ノイズから境界点に昇格
            }
            if (visited[curr]) continue;
            
            visited[curr] = true;
            labels[curr] = clusterId;
            
            if (neighbors[curr].length >= minPts) {
                for (let q = 0; q < neighbors[curr].length; q++) {
                    const pt = neighbors[curr][q];
                    if (!seedSet.includes(pt) && pt !== curr) {
                        seedSet.push(pt);
                    }
                }
            }
        }
        clusterId++;
    }
    
    for (let i = 0; i < n; i++) {
        if (labels[i] === undefined) labels[i] = -1;
    }
    
    const numClusters = clusterId;
    const numNoise = labels.filter(l => l === -1).length;
    return { labels, numClusters, numNoise };
}

function estimateDBSCAN_Eps(data, minPts = 3) {
    const n = data.length;
    if (n <= minPts) return 1.0;
    
    const k = Math.max(1, minPts - 1);
    const kDistances = [];
    for (let i = 0; i < n; i++) {
        const dists = [];
        for (let j = 0; j < n; j++) {
            if (i !== j) {
                dists.push(euclideanDistance(data[i], data[j]));
            }
        }
        dists.sort((a, b) => a - b);
        kDistances.push(dists[Math.min(k, dists.length - 1)]);
    }
    
    kDistances.sort((a, b) => a - b);
    const targetIdx = Math.floor(kDistances.length * 0.65);
    const estimated = kDistances[targetIdx];
    return Math.max(0.05, parseFloat(estimated.toFixed(2)));
}

function updateDBSCANSummaryUI() {
    const summaryEl = document.getElementById('dbscan-result-summary');
    if (!summaryEl || !pcaResult || !pcaResult.dbscanStats) return;
    const { numClusters, numNoise } = pcaResult.dbscanStats;
    summaryEl.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
            <span>検出クラスタ: <strong style="color: #2563eb;">${numClusters}個</strong></span>
            <span>外れ値 (ノイズ): <strong style="color: ${numNoise > 0 ? '#dc2626' : '#16a34a'};">${numNoise}件</strong></span>
        </div>
    `;
}

function autoConfigureDBSCAN(applyImmediately = true) {
    if (!pcaResult) return;
    const data = getClusteringInputData(pcaResult);
    const minPtsInput = document.getElementById('dbscan-min-pts');
    const minPts = minPtsInput ? parseInt(minPtsInput.value) : 3;
    
    const optEps = estimateDBSCAN_Eps(data, minPts);
    dbscanEps = optEps;
    
    const epsInput = document.getElementById('dbscan-eps');
    const epsValSpan = document.getElementById('dbscan-eps-val');
    if (epsInput) {
        const minEps = Math.max(0.02, parseFloat((optEps * 0.1).toFixed(2)));
        const maxEps = Math.max(optEps * 3.0, 5.0);
        epsInput.min = minEps;
        epsInput.max = parseFloat(maxEps.toFixed(2));
        epsInput.step = parseFloat((optEps * 0.05).toFixed(2)) || 0.05;
        epsInput.value = optEps;
    }
    if (epsValSpan) epsValSpan.textContent = optEps.toFixed(2);
    
    if (applyImmediately && clusterMethod === 'dbscan') {
        updateClustersForCurrentSettings();
        updatePlot();
    }
}

function updateClustersForCurrentSettings() {
    if (!pcaResult) return;
    const dataForClustering = getClusteringInputData(pcaResult);
    
    if (clusterMethod === 'dbscan') {
        const epsInput = document.getElementById('dbscan-eps');
        const minPtsInput = document.getElementById('dbscan-min-pts');
        const eps = epsInput ? parseFloat(epsInput.value) : dbscanEps;
        const minPts = minPtsInput ? parseInt(minPtsInput.value) : dbscanMinPts;
        
        const dbRes = runDBSCAN(dataForClustering, eps, minPts);
        pcaResult.clusters = dbRes.labels;
        pcaResult.dbscanStats = {
            numClusters: dbRes.numClusters,
            numNoise: dbRes.numNoise
        };
        updateDBSCANSummaryUI();
    } else {
        const k = parseInt(clusterCount ? clusterCount.value : 3);
        pcaResult.clusters = kMeansBest(dataForClustering, k).clusters;
    }
}

if (axisXSelect) {
    axisXSelect.addEventListener('change', () => {
        const newX = axisXSelect.value;
        if (axisYSelect && newX === axisYSelect.value) {
            axisYSelect.value = prevAxisX;
            prevAxisY = prevAxisX;
        }
        if (axisZSelect && newX === axisZSelect.value) {
            const options = Array.from(axisZSelect.options).map(o => o.value);
            const other = options.find(val => val !== newX && val !== (axisYSelect ? axisYSelect.value : null));
            if (other !== undefined) {
                axisZSelect.value = other;
                prevAxisZ = other;
            }
        }
        prevAxisX = newX;
        if (clusterSpace === 'pc') {
            recalculateOptimalKForCurrentSpace();
            updateClustersForCurrentSettings();
        }
        updatePlot();
        renderLoadingsChart();
    });
}
if (axisYSelect) {
    axisYSelect.addEventListener('change', () => {
        const newY = axisYSelect.value;
        if (axisXSelect && newY === axisXSelect.value) {
            axisXSelect.value = prevAxisY;
            prevAxisX = prevAxisY;
        }
        if (axisZSelect && newY === axisZSelect.value) {
            const options = Array.from(axisZSelect.options).map(o => o.value);
            const other = options.find(val => val !== newY && val !== (axisXSelect ? axisXSelect.value : null));
            if (other !== undefined) {
                axisZSelect.value = other;
                prevAxisZ = other;
            }
        }
        prevAxisY = newY;
        if (clusterSpace === 'pc') {
            recalculateOptimalKForCurrentSpace();
            updateClustersForCurrentSettings();
        }
        updatePlot();
        renderLoadingsChart();
    });
}
if (axisZSelect) {
    axisZSelect.addEventListener('change', () => {
        const newZ = axisZSelect.value;
        const xVal = axisXSelect ? axisXSelect.value : null;
        const yVal = axisYSelect ? axisYSelect.value : null;
        if (newZ === xVal || newZ === yVal) {
            const options = Array.from(axisZSelect.options).map(o => o.value);
            const avail = options.find(val => val !== xVal && val !== yVal);
            if (avail !== undefined) {
                axisZSelect.value = avail;
            }
        }
        prevAxisZ = axisZSelect.value;
        if (clusterSpace === 'pc') {
            recalculateOptimalKForCurrentSpace();
            updateClustersForCurrentSettings();
        }
        updatePlot();
    });
}

if (enable3dCheck) {
    enable3dCheck.addEventListener('change', (e) => {
        if (e.target.checked) {
            if (zAxisGroup) zAxisGroup.style.display = 'block';
        } else {
            if (zAxisGroup) zAxisGroup.style.display = 'none';
        }
        if (pcaResult) {
            if (clusterSpace === 'pc') {
                recalculateOptimalKForCurrentSpace();
                updateClustersForCurrentSettings();
            }
            updatePlot();
        }
    });
}

if (vectorScale) {
    vectorScale.addEventListener('input', (e) => {
        currentScale = parseFloat(e.target.value);
        if (vectorScaleVal) vectorScaleVal.textContent = `x${currentScale.toFixed(1)}`;
        if (pcaResult) updatePlot();
    });
}
const showLabelsCheckbox = document.getElementById('show-labels');
if (showLabelsCheckbox) {
    showLabelsCheckbox.addEventListener('change', () => {
        if(pcaResult) updatePlot();
    });
}
const showVectorsCheckbox = document.getElementById('show-vectors');
if (showVectorsCheckbox) {
    showVectorsCheckbox.addEventListener('change', () => {
        if(pcaResult) updatePlot();
    });
}
const enableClusteringCheckbox = document.getElementById('enable-clustering');
if (enableClusteringCheckbox) {
    enableClusteringCheckbox.addEventListener('change', () => {
        if(pcaResult) updatePlot();
    });
}
if (plotTitleInput) {
    plotTitleInput.addEventListener('input', () => {
        if(pcaResult) updatePlot();
    });
}

function updateOptimalKUI(optK) {
    const btnApplyOpt = document.getElementById('btn-apply-optimal-k');
    const badgeOpt = document.getElementById('optimal-k-badge');
    if (btnApplyOpt) btnApplyOpt.innerHTML = `✨ 最適値 (K=${optK})`;
    if (badgeOpt) badgeOpt.textContent = `推奨: K=${optK}`;
}

function applyOptimalKToSlider(optK) {
    if (!optK || !clusterCount) return;
    clusterCount.value = optK;
    const clusterValSpan = document.getElementById('cluster-value');
    if (clusterValSpan) clusterValSpan.textContent = optK;
    
    // スライダー増減ボタンの状態を更新
    const decBtn = document.getElementById('btn-cluster-count-dec');
    const incBtn = document.getElementById('btn-cluster-count-inc');
    if (decBtn && incBtn) {
        decBtn.disabled = optK <= parseFloat(clusterCount.min || 1);
        incBtn.disabled = optK >= parseFloat(clusterCount.max || 10);
    }
    
    if (pcaResult) {
        updateClustersForCurrentSettings();
        updatePlot();
        renderElbowPlot();
    }
}

function recalculateOptimalKForCurrentSpace() {
    if (!pcaResult) return;
    const dataForClustering = getClusteringInputData(pcaResult);
    const optKInfo = determineOptimalK(dataForClustering);
    pcaResult.optimalK = optKInfo.optimalK;
    pcaResult.wcss = optKInfo.wcss;
    updateOptimalKUI(pcaResult.optimalK);
    
    const autoOptCb = document.getElementById('auto-optimal-k');
    if (autoOptCb && autoOptCb.checked) {
        applyOptimalKToSlider(pcaResult.optimalK);
    } else {
        renderElbowPlot();
    }
}

const clusterSpaceSelect = document.getElementById('cluster-space-select');
if (clusterSpaceSelect) {
    clusterSpaceSelect.addEventListener('change', (e) => {
        clusterSpace = e.target.value;
        if (pcaResult) {
            recalculateOptimalKForCurrentSpace();
            updateClustersForCurrentSettings();
            updatePlot();
        }
    });
}

const btnApplyOptimalK = document.getElementById('btn-apply-optimal-k');
if (btnApplyOptimalK) {
    btnApplyOptimalK.addEventListener('click', () => {
        const autoOptCb = document.getElementById('auto-optimal-k');
        if (autoOptCb) autoOptCb.checked = true;
        if (pcaResult && pcaResult.optimalK) {
            applyOptimalKToSlider(pcaResult.optimalK);
        }
    });
}

const autoOptimalKCb = document.getElementById('auto-optimal-k');
if (autoOptimalKCb) {
    autoOptimalKCb.addEventListener('change', (e) => {
        if (e.target.checked && pcaResult && pcaResult.optimalK) {
            applyOptimalKToSlider(pcaResult.optimalK);
        }
    });
}

if (clusterCount) {
    const handleClusterChange = (e) => {
        const k = parseInt(e.target.value);
        const clusterValSpan = document.getElementById('cluster-value');
        if (clusterValSpan) clusterValSpan.textContent = k;
        
        // ユーザーが手動で最適値と異なるクラスタ数を選択した場合は自動設定チェックを解除
        const autoOptCb = document.getElementById('auto-optimal-k');
        if (autoOptCb && pcaResult && k !== pcaResult.optimalK) {
            autoOptCb.checked = false;
        }
        
        if (pcaResult) {
            updateClustersForCurrentSettings();
            updatePlot();
        }
    };
    clusterCount.addEventListener('input', handleClusterChange);
    clusterCount.addEventListener('change', handleClusterChange);
}

// スライダーの＋／ーボタン処理
function setupSliderStepButtons(sliderId, decBtnId, incBtnId) {
    const slider = document.getElementById(sliderId);
    const decBtn = document.getElementById(decBtnId);
    const incBtn = document.getElementById(incBtnId);
    if (!slider || !decBtn || !incBtn) return;

    const updateButtonStates = () => {
        const val = parseFloat(slider.value);
        const min = parseFloat(slider.min);
        const max = parseFloat(slider.max);
        if (!isNaN(min)) decBtn.disabled = val <= min;
        if (!isNaN(max)) incBtn.disabled = val >= max;
    };

    const adjustValue = (direction) => {
        const step = parseFloat(slider.step) || 1;
        const min = slider.min !== "" ? parseFloat(slider.min) : -Infinity;
        const max = slider.max !== "" ? parseFloat(slider.max) : Infinity;
        let val = parseFloat(slider.value) || 0;

        const stepStr = slider.step || "1";
        const decimals = stepStr.includes(".") ? stepStr.split(".")[1].length : 0;

        val += direction * step;
        if (decimals > 0) {
            val = parseFloat(val.toFixed(decimals));
        }
        if (val < min) val = min;
        if (val > max) val = max;

        if (parseFloat(slider.value) !== val) {
            slider.value = val;
            slider.dispatchEvent(new Event("input", { bubbles: true }));
            slider.dispatchEvent(new Event("change", { bubbles: true }));
        }
        updateButtonStates();
    };

    decBtn.addEventListener('click', () => adjustValue(-1));
    incBtn.addEventListener('click', () => adjustValue(1));
    slider.addEventListener('input', updateButtonStates);
    slider.addEventListener('change', updateButtonStates);

    updateButtonStates();
}

setupSliderStepButtons('vector-scale', 'btn-vector-scale-dec', 'btn-vector-scale-inc');
setupSliderStepButtons('cluster-count', 'btn-cluster-count-dec', 'btn-cluster-count-inc');
setupSliderStepButtons('dbscan-eps', 'btn-dbscan-eps-dec', 'btn-dbscan-eps-inc');
setupSliderStepButtons('dbscan-min-pts', 'btn-dbscan-min-pts-dec', 'btn-dbscan-min-pts-inc');

// DBSCAN コントロールリスナー
const clusterMethodSelect = document.getElementById('cluster-method-select');
const kmeansControlsPanel = document.getElementById('kmeans-controls-panel');
const dbscanControlsPanel = document.getElementById('dbscan-controls-panel');

if (clusterMethodSelect) {
    clusterMethodSelect.addEventListener('change', (e) => {
        clusterMethod = e.target.value;
        if (clusterMethod === 'dbscan') {
            if (kmeansControlsPanel) kmeansControlsPanel.classList.add('hidden');
            if (dbscanControlsPanel) dbscanControlsPanel.classList.remove('hidden');
            if (pcaResult) autoConfigureDBSCAN(true);
        } else {
            if (kmeansControlsPanel) kmeansControlsPanel.classList.remove('hidden');
            if (dbscanControlsPanel) dbscanControlsPanel.classList.add('hidden');
            if (pcaResult) {
                updateClustersForCurrentSettings();
                updatePlot();
            }
        }
    });
}

const dbscanEpsInput = document.getElementById('dbscan-eps');
if (dbscanEpsInput) {
    const handleEpsChange = (e) => {
        dbscanEps = parseFloat(e.target.value);
        const valSpan = document.getElementById('dbscan-eps-val');
        if (valSpan) valSpan.textContent = dbscanEps.toFixed(2);
        if (pcaResult && clusterMethod === 'dbscan') {
            updateClustersForCurrentSettings();
            updatePlot();
        }
    };
    dbscanEpsInput.addEventListener('input', handleEpsChange);
    dbscanEpsInput.addEventListener('change', handleEpsChange);
}

const dbscanMinPtsInput = document.getElementById('dbscan-min-pts');
if (dbscanMinPtsInput) {
    const handleMinPtsChange = (e) => {
        dbscanMinPts = parseInt(e.target.value);
        const valSpan = document.getElementById('dbscan-min-pts-val');
        if (valSpan) valSpan.textContent = dbscanMinPts;
        if (pcaResult && clusterMethod === 'dbscan') {
            updateClustersForCurrentSettings();
            updatePlot();
        }
    };
    dbscanMinPtsInput.addEventListener('input', handleMinPtsChange);
    dbscanMinPtsInput.addEventListener('change', handleMinPtsChange);
}

const btnAutoDbscanEps = document.getElementById('btn-auto-dbscan-eps');
if (btnAutoDbscanEps) {
    btnAutoDbscanEps.addEventListener('click', () => {
        autoConfigureDBSCAN(true);
    });
}

if (btnReset) {
    btnReset.addEventListener('click', () => {
        transformMode = 'std';
        missingMode = 'drop';
        clusterSpace = 'all';
        clusterMethod = 'kmeans';
        corrMethod = 'pearson';
        dbscanEps = 1.0;
        dbscanMinPts = 3;
        disabledFeatures = new Set();
        disabledRowIndices = new Set();
        detectedOutlierIndices = new Set();
        prevAxisX = "0";
        prevAxisY = "1";
        prevAxisZ = "2";
        
        if (clusterMethodSelect) clusterMethodSelect.value = 'kmeans';
        if (kmeansControlsPanel) kmeansControlsPanel.classList.remove('hidden');
        if (dbscanControlsPanel) dbscanControlsPanel.classList.add('hidden');

        const transformSelect = document.getElementById('transform-mode-select');
        const transformSelect2 = document.getElementById('transform-mode-select-step2');
        if (transformSelect) transformSelect.value = 'std';
        if (transformSelect2) transformSelect2.value = 'std';
        
        const missingSelect = document.getElementById('missing-mode-select');
        const missingSelect2 = document.getElementById('missing-mode-select-step2');
        if (missingSelect) missingSelect.value = 'drop';
        if (missingSelect2) missingSelect2.value = 'drop';

        const clusterSpaceSelect = document.getElementById('cluster-space-select');
        if (clusterSpaceSelect) clusterSpaceSelect.value = 'all';

        const autoOptCb = document.getElementById('auto-optimal-k');
        if (autoOptCb) autoOptCb.checked = true;
        updateOptimalKUI(3);

        splomMaxVars = 'all';
        const splomMaxVarsSelect = document.getElementById('splom-max-vars');
        if (splomMaxVarsSelect) splomMaxVarsSelect.value = 'all';
        
        const pearsonRadio = document.querySelector('input[name="corr-method"][value="pearson"]');
        if (pearsonRadio) pearsonRadio.checked = true;

        const toggleScreeCb = document.getElementById('show-scree-plot');
        if (toggleScreeCb) toggleScreeCb.checked = false;
        const toggleElbow = document.getElementById('show-elbow-plot');
        if (toggleElbow) toggleElbow.checked = false;
        const toggleLoadingsCb = document.getElementById('show-loadings-chart');
        if (toggleLoadingsCb) toggleLoadingsCb.checked = false;
        
        const showVectorsCb = document.getElementById('show-vectors');
        if (showVectorsCb) showVectorsCb.checked = true;
        const enableClusteringCb = document.getElementById('enable-clustering');
        if (enableClusteringCb) enableClusteringCb.checked = true;
        const showLabelsCb = document.getElementById('show-labels');
        if (showLabelsCb) showLabelsCb.checked = true;
        
        const screeContainer = document.getElementById('scree-container');
        if (screeContainer) screeContainer.classList.add('hidden');
        const elbowContainer = document.getElementById('elbow-container');
        if (elbowContainer) elbowContainer.classList.add('hidden');
        const loadingsContainer = document.getElementById('loadings-container');
        if (loadingsContainer) loadingsContainer.classList.add('hidden');
        
        rawNumericData = [];
        numericData = [];
        labels = [];
        features = null;
        pcaResult = null;
        if (uploadSection) uploadSection.classList.remove('hidden');
        if (resultsSection) resultsSection.classList.add('hidden');
        if (dataPreview) dataPreview.classList.add('hidden');
        const noticeBanner = document.getElementById('data-notice-banner');
        if (noticeBanner) {
            noticeBanner.classList.add('hidden');
            noticeBanner.innerHTML = '';
        }
        if (fileInput) fileInput.value = "";
    });
}

if (btnBackToData) {
    btnBackToData.addEventListener('click', () => {
        resultsSection.classList.add('hidden');
        uploadSection.classList.remove('hidden');
        renderPreview();
        renderStatistics();
        renderDataDiagnosis();
        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
        }, 50);
    });
}

const toggleShowAll = document.getElementById('show-all-data');
if (toggleShowAll) {
    toggleShowAll.addEventListener('change', () => {
        if (numericData.length > 0) renderPreview();
    });
}

// Transform Select Handlers
const transformSelect = document.getElementById('transform-mode-select');
const transformSelect2 = document.getElementById('transform-mode-select-step2');
const transformBadge = document.getElementById('transform-badge');
const transformHint = document.getElementById('transform-hint');

const transformHints = {
    std: "💡 <b>標準化 (Z-Score)</b>: 平均を0、標準偏差を1に揃え、変数ごとの単位差（例：金額と人数）による影響をなくします (標準)。",
    log: "📈 <b>対数変換 + 標準化</b>: 金額や売上など一部の極端な高値を対数でマイルドにし、その後標準化します。",
    robust: "🛡️ <b>ロバスト標準化 (Median/IQR)</b>: 平均・標準偏差ではなく中央値と四分位範囲基準で揃え、特異な外れ値の影響を抑えます。",
    none: "直値: 補正や単位調整を行わず、生データをそのまま使用します。"
};

const transformBadges = {
    std: "✨ 標準化 (Z-Score) 適用中",
    log: "📈 対数変換 + 標準化 適用中",
    robust: "🛡️ ロバスト標準化 適用中",
    none: "生データ (変換なし)"
};

function handleTransformChange(newMode) {
    transformMode = newMode;
    if (transformSelect) transformSelect.value = transformMode;
    if (transformSelect2) transformSelect2.value = transformMode;
    if (transformBadge) transformBadge.textContent = transformBadges[transformMode] || transformMode;
    if (transformHint) transformHint.innerHTML = transformHints[transformMode] || '';
    
    if (rawNumericData && rawNumericData.length > 0) {
        applyStandardization();
        refreshAllVisualizations();
    }
}

if (transformSelect) {
    transformSelect.addEventListener('change', (e) => handleTransformChange(e.target.value));
}
if (transformSelect2) {
    transformSelect2.addEventListener('change', (e) => handleTransformChange(e.target.value));
}

// Missing Mode Select Handlers
const missingSelect = document.getElementById('missing-mode-select');
const missingSelect2 = document.getElementById('missing-mode-select-step2');
const missingHint = document.getElementById('missing-hint');

const missingHints = {
    drop: "💡 <b>欠測行を除外</b>: 1つでも欠測がある行を分析対象から除外します（統計的バイアスが最も少ない標準手法）。",
    mean: "📊 <b>平均値で補完</b>: 各変数の平均値で空欄を埋め、サンプル数を減らさずに分析します。",
    median: "🛡️ <b>中央値で補完</b>: 各変数の中央値で空欄を埋め、外れ値の影響を受けにくく補完します。"
};

function handleMissingChange(newMode) {
    missingMode = newMode;
    if (missingSelect) missingSelect.value = missingMode;
    if (missingSelect2) missingSelect2.value = missingMode;
    if (missingHint) missingHint.innerHTML = missingHints[missingMode] || '';
    
    if (rawNumericData && rawNumericData.length > 0) {
        applyStandardization();
        refreshAllVisualizations();
    }
}

if (missingSelect) {
    missingSelect.addEventListener('change', (e) => handleMissingChange(e.target.value));
}
if (missingSelect2) {
    missingSelect2.addEventListener('change', (e) => handleMissingChange(e.target.value));
}

// Correlation Method Handler
document.querySelectorAll('input[name="corr-method"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        corrMethod = e.target.value;
        renderCorrelationHeatmap();
        if (currentRelView === 'splom') {
            renderSPLOM();
        }
    });
});

// Outlier Action Buttons
const btnExcludeOutliers = document.getElementById('btn-exclude-outliers');
if (btnExcludeOutliers) {
    btnExcludeOutliers.addEventListener('click', () => {
        if (detectedOutlierIndices.size === 0) {
            alert("現在、1.5×IQR基準を超える外れ値サンプルは検出されていません。");
            return;
        }
        const count = detectedOutlierIndices.size;
        detectedOutlierIndices.forEach(idx => disabledRowIndices.add(idx));
        refreshAllVisualizations();
        alert(`⚡ 特徴的なサンプル（外れ値）${count}件を分析対象から一括除外しました。\n（除外後の有効データに基づいて前処理パラメータとPCAが再計算されました）`);
    });
}

const btnResetSampleExclusion = document.getElementById('btn-reset-sample-exclusion');
if (btnResetSampleExclusion) {
    btnResetSampleExclusion.addEventListener('click', () => {
        const prevCount = disabledRowIndices.size;
        disabledRowIndices.clear();
        refreshAllVisualizations();
        alert(`🔄 全サンプル（${labels.length}件）を分析対象に戻しました。`);
    });
}

const btnToggleSamplePanel = document.getElementById('btn-toggle-sample-panel');
const samplePanel = document.getElementById('sample-selection-panel');
if (btnToggleSamplePanel && samplePanel) {
    btnToggleSamplePanel.addEventListener('click', () => {
        samplePanel.classList.toggle('hidden');
    });
}

const sampleSearchInput = document.getElementById('sample-search-input');
if (sampleSearchInput) {
    sampleSearchInput.addEventListener('input', () => {
        renderSampleCheckboxPanel();
    });
}

const toggleScree = document.getElementById('show-scree-plot');
if (toggleScree) {
    toggleScree.addEventListener('change', () => renderScreePlot());
}
const toggleElbow = document.getElementById('show-elbow-plot');
if (toggleElbow) {
    toggleElbow.addEventListener('change', () => renderElbowPlot());
}
const toggleLoadings = document.getElementById('show-loadings-chart');
if (toggleLoadings) {
    toggleLoadings.addEventListener('change', () => renderLoadingsChart());
}

const btnViewHeatmap = document.getElementById('btn-view-heatmap');
const btnViewSplom = document.getElementById('btn-view-splom');
const heatmapWrapper = document.getElementById('heatmap-view-wrapper');
const splomWrapper = document.getElementById('splom-view-wrapper');

if (btnViewHeatmap && btnViewSplom) {
    btnViewHeatmap.addEventListener('click', () => {
        currentRelView = 'heatmap';
        btnViewHeatmap.classList.add('active');
        btnViewSplom.classList.remove('active');
        if (heatmapWrapper) heatmapWrapper.classList.remove('hidden');
        if (splomWrapper) splomWrapper.classList.add('hidden');
        setTimeout(() => {
            renderCorrelationHeatmap();
            window.dispatchEvent(new Event('resize'));
        }, 10);
    });
    btnViewSplom.addEventListener('click', () => {
        currentRelView = 'splom';
        btnViewSplom.classList.add('active');
        btnViewHeatmap.classList.remove('active');
        if (splomWrapper) splomWrapper.classList.remove('hidden');
        if (heatmapWrapper) heatmapWrapper.classList.add('hidden');
        setTimeout(() => {
            renderSPLOM();
            window.dispatchEvent(new Event('resize'));
        }, 10);
    });
}

const splomMaxVarsSelect = document.getElementById('splom-max-vars');
if (splomMaxVarsSelect) {
    splomMaxVarsSelect.addEventListener('change', (e) => {
        splomMaxVars = e.target.value;
        if (currentRelView === 'splom') {
            renderSPLOM();
        }
    });
}

btnDownloadCsv.addEventListener('click', downloadCsv);
btnDownloadPng.addEventListener('click', () => {
    Plotly.downloadImage('plot-container', {format: 'png', width: 1200, height: 800, filename: 'pca_biplot'});
});

const pasteInput = document.getElementById('paste-input');
const btnParsePaste = document.getElementById('btn-parse-paste');
if (btnParsePaste && pasteInput) {
    btnParsePaste.addEventListener('click', () => {
        const text = pasteInput.value.trim();
        if (!text) {
            alert("データを貼り付けてからボタンを押してください。");
            return;
        }
        parseTextWithAutoDelimiter(text, 'txt');
    });
}


// --- Functions ---

function parseTextWithAutoDelimiter(text, ext = 'txt') {
    if (!text || text.trim() === '') {
        alert("データが空です。有効な表形式のデータを入力してください。");
        return;
    }

    const trimmed = text.trim();

    // 1. TSV形式 (.tsv) の場合: タブ区切りを最優先
    if (ext === 'tsv') {
        const tsvRes = Papa.parse(trimmed, {
            delimiter: "\t",
            header: false,
            skipEmptyLines: true
        });
        if (tsvRes.data && tsvRes.data.length >= 3 && tsvRes.data[0].length >= 2) {
            processRawData(tsvRes.data);
            return;
        }
        // タブで2列以上にならなかった場合は、自動判別へフォールバック
    }

    // 2. CSV形式 (.csv) の場合: カンマ区切りを最優先
    if (ext === 'csv') {
        const csvRes = Papa.parse(trimmed, {
            delimiter: ",",
            header: false,
            skipEmptyLines: true
        });
        if (csvRes.data && csvRes.data.length >= 3 && csvRes.data[0].length >= 2) {
            processRawData(csvRes.data);
            return;
        }
        // カンマで2列以上にならなかった場合は、自動判別へフォールバック
    }

    // 3. PapaParse による自動デリミタ検出 (カンマ、タブ、セミコロン、パイプ等)
    const autoRes = Papa.parse(trimmed, {
        delimiter: "", // 自動検出
        header: false,
        skipEmptyLines: true
    });

    if (autoRes.data && autoRes.data.length >= 3) {
        const firstCols = autoRes.data[0].length;
        if (firstCols >= 2) {
            // 列数の一貫性を検査（先頭15行中80%以上が同等の列数か）
            const sample = autoRes.data.slice(0, Math.min(15, autoRes.data.length));
            const consistentCount = sample.filter(r => Math.abs(r.length - firstCols) <= 1).length;
            if (consistentCount / sample.length >= 0.8) {
                processRawData(autoRes.data);
                return;
            }
        }
    }

    // 4. 空白（スペース / 連続空白）区切りの検出
    const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length >= 3) {
        const wsRows = lines.map(line => line.split(/\s+/));
        const firstCols = wsRows[0].length;
        if (firstCols >= 2) {
            const sample = wsRows.slice(0, Math.min(15, wsRows.length));
            const consistentCount = sample.filter(r => Math.abs(r.length - firstCols) <= 1).length;
            if (consistentCount / sample.length >= 0.8) {
                processRawData(wsRows);
                return;
            }
        }
    }

    // 5. セミコロン区切り明示的フォールバック
    const semiRes = Papa.parse(trimmed, {
        delimiter: ";",
        header: false,
        skipEmptyLines: true
    });
    if (semiRes.data && semiRes.data.length >= 3 && semiRes.data[0].length >= 2) {
        processRawData(semiRes.data);
        return;
    }

    // 6. 区切りが判断できない場合
    const extNotice = ext ? `（.${ext}）` : "";
    alert(`⚠️ ファイル${extNotice}の区切り文字を自動判別できませんでした。\n\n【原因・ヒント】\n・タブ (\\t)、カンマ (,)、セミコロン (;)、または空白で区切られた「2列以上（行ラベル＋数値列）」の表形式データである必要があります。\n・1列のみの文章や、行ごとに区切りが不揃いなデータは読み込めません。\n・区切り文字を確認のうえ、ファイル形式や内容を整えて再試行してください。`);
}

function handleFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    
    if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target.result;
            parseTextWithAutoDelimiter(text, ext);
        };
        reader.onerror = () => {
            alert("ファイルの読み込み中にエラーが発生しました。");
        };
        reader.readAsText(file, 'utf-8');
    } else if (ext === 'xlsx' || ext === 'xls') {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, {type: 'array'});
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const jsonData = XLSX.utils.sheet_to_json(firstSheet, {header: 1});
                processRawData(jsonData);
            } catch (err) {
                console.error("XLSX read error:", err);
                alert("Excelファイルの読み込みに失敗しました。ファイルが破損していないか確認してください。");
            }
        };
        reader.readAsArrayBuffer(file);
    } else {
        alert("未対応のファイル形式です。.csv, .tsv, .txt, または .xlsx を使用してください。");
    }
}

function processRawData(data) {
    try {
        if (!data || data.length < 3) {
            alert("データが少なすぎます。分析にはより多くの行が必要です。");
            return;
        }
        
        const headerRow = data[0];
        const validColIndices = [];
        const featureNames = [];
        const nonNumericCols = [];
        
        // ヘッダー行以降のデータ行から、各列の数値比率を検証（文字列・カテゴリ列を自動判別）
        for (let j = 1; j < headerRow.length; j++) {
            const colName = String(headerRow[j] || '').trim();
            if (colName === '') continue;
            
            let nonEmptyCount = 0;
            let numericCount = 0;
            for (let i = 1; i < data.length; i++) {
                const row = data[i];
                if (!row || row.length <= j) continue;
                const cell = row[j];
                if (cell !== undefined && cell !== null && String(cell).trim() !== '') {
                    nonEmptyCount++;
                    const cleanStr = String(cell).trim().replace(/,/g, '');
                    const num = parseFloat(cleanStr);
                    if (!isNaN(num) && isFinite(num)) {
                        numericCount++;
                    }
                }
            }
            // 空列ではなく、かつ非空値のうち過半数(50%以上)が数値であれば分析対象の数値変数と判定
            if (nonEmptyCount > 0 && (numericCount / nonEmptyCount >= 0.5)) {
                validColIndices.push(j);
                featureNames.push(colName);
            } else {
                nonNumericCols.push(colName);
            }
        }
        
        // 数値変数が不足している場合の早期エラーガード
        if (featureNames.length < 2) {
            let msg = "⚠️ 主成分分析（PCA）を行うには、少なくとも2列以上の数値データが必要です。\n";
            if (nonNumericCols.length > 0) {
                msg += `\n【検出された非数値列（文字列・カテゴリ等）】\n・${nonNumericCols.join('\n・')}\n`;
            }
            msg += "\n数値データが含まれる表形式ファイル（CSV, TSV, TXT, Excel等）を指定してください。";
            alert(msg);
            return;
        }
        
        features = featureNames;
        
        const rawLabels = [];
        const parsedNumeric = [];
        
        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            if (!row || row.length === 0) continue;
            // 行内のすべてのセルが空の場合はスキップ
            const isRowAllEmpty = row.every(cell => cell === undefined || cell === null || String(cell).trim() === '');
            if (isRowAllEmpty) continue;
            
            const numericRow = [];
            for (const j of validColIndices) {
                const cell = (row[j] !== undefined && row[j] !== null) ? row[j] : '';
                const cleanStr = String(cell).trim().replace(/,/g, '');
                const val = cleanStr === '' ? NaN : parseFloat(cleanStr);
                numericRow.push(val); // 欠測や無効値は NaN として保持
            }
            
            const labelStr = (row[0] !== undefined && row[0] !== null && String(row[0]).trim() !== '') ? String(row[0]).trim() : `Row ${i}`;
            rawLabels.push(labelStr);
            parsedNumeric.push(numericRow);
        }
        
        labels = rawLabels;
        rawNumericData = parsedNumeric;
        disabledFeatures = new Set();
        disabledRowIndices = new Set();
        detectedOutlierIndices = new Set();
        pcaResult = null;
        
        // 文字列・カテゴリ列が除外された場合の案内バナー
        const noticeBanner = document.getElementById('data-notice-banner');
        if (noticeBanner) {
            if (nonNumericCols.length > 0) {
                noticeBanner.classList.remove('hidden');
                noticeBanner.innerHTML = `
                    <div style="display: flex; align-items: flex-start; gap: 0.65rem; background: #eff6ff; border: 1px solid #bfdbfe; color: #1e40af; padding: 0.75rem 1rem; border-radius: 8px; font-size: 0.88rem; line-height: 1.5;">
                        <span style="font-size: 1.15rem; line-height: 1;">ℹ️</span>
                        <div>
                            <strong>文字列・カテゴリ列を自動検出しました:</strong><br>
                            「${nonNumericCols.map(c => `<code>${c}</code>`).join('」「')}」は数値ではないため、主成分分析（PCA）の数値変数から自動除外されました（${featureNames.length}個の数値変数を読み込みました）。
                        </div>
                    </div>
                `;
            } else {
                noticeBanner.classList.add('hidden');
                noticeBanner.innerHTML = '';
            }
        }
        
        applyStandardization();
        
        renderPreview();
        renderStatistics();
        renderDataDiagnosis();
        dataPreview.classList.remove('hidden');
    } catch (err) {
        console.error("processRawData error:", err);
        alert("データの表示・初期処理中にエラーが発生しました: " + err.message);
    }
}

function applyStandardization() {
    if (!rawNumericData || rawNumericData.length === 0) return;
    const n = rawNumericData.length;
    const p = rawNumericData[0].length;
    
    numericData = JSON.parse(JSON.stringify(rawNumericData)); 
    
    // 1. 欠測値の補完処理 (mean または median モード時)
    if (missingMode === 'mean' || missingMode === 'median') {
        for (let j = 0; j < p; j++) {
            const validVals = [];
            for (let i = 0; i < n; i++) {
                if (!disabledRowIndices.has(i) && !isNaN(rawNumericData[i][j]) && rawNumericData[i][j] !== null) {
                    validVals.push(rawNumericData[i][j]);
                }
            }
            if (validVals.length > 0) {
                let fillVal = 0;
                if (missingMode === 'mean') {
                    fillVal = validVals.reduce((a, b) => a + b, 0) / validVals.length;
                } else {
                    validVals.sort((a, b) => a - b);
                    const mid = Math.floor(validVals.length / 2);
                    fillVal = validVals.length % 2 !== 0 ? validVals[mid] : (validVals[mid - 1] + validVals[mid]) / 2;
                }
                for (let i = 0; i < n; i++) {
                    if (isNaN(numericData[i][j]) || numericData[i][j] === null) {
                        numericData[i][j] = fillVal;
                    }
                }
            }
        }
    }
    
    // 'none' モード: 補完後の生データをそのまま保持（中心化は runPCA 内部の Xc でのみ実行）
    if (transformMode === 'none') {
        return;
    }
    
    // PCAおよび分析に投入されるアクティブ行集合を取得（母集団の完全一致を保証）
    const activeRows = new Set(getActiveRowIndices());
    
    if (transformMode === 'log') {
        // 対数変換のシフト幅（アクティブサンプルの最小値に基づく）
        for (let j = 0; j < p; j++) {
            let minVal = Infinity;
            for (let i = 0; i < n; i++) {
                if (activeRows.has(i) && !isNaN(numericData[i][j]) && numericData[i][j] < minVal) {
                    minVal = numericData[i][j];
                }
            }
            if (minVal === Infinity) minVal = 0;
            const shift = minVal < 0 ? Math.abs(minVal) + 1 : 0;
            for (let i = 0; i < n; i++) {
                if (!isNaN(numericData[i][j])) {
                    numericData[i][j] = Math.log(numericData[i][j] + shift + 1);
                }
            }
        }
        // 対数変換後のアクティブサンプル平均・標準偏差で標準化
        for (let j = 0; j < p; j++) {
            let sum = 0, count = 0;
            for (let i = 0; i < n; i++) {
                if (activeRows.has(i) && !isNaN(numericData[i][j])) {
                    sum += numericData[i][j];
                    count++;
                }
            }
            const mean = count > 0 ? sum / count : 0;
            let sumSq = 0;
            for (let i = 0; i < n; i++) {
                if (activeRows.has(i) && !isNaN(numericData[i][j])) {
                    sumSq += Math.pow(numericData[i][j] - mean, 2);
                }
            }
            const stdDev = Math.sqrt(sumSq / (count > 1 ? count - 1 : 1)) || 1;
            for (let i = 0; i < n; i++) {
                if (!isNaN(numericData[i][j])) {
                    numericData[i][j] = (numericData[i][j] - mean) / stdDev;
                }
            }
        }
    } else if (transformMode === 'robust') {
        // ロバスト標準化: アクティブサンプルの中央値と四分位範囲 (IQR)
        for (let j = 0; j < p; j++) {
            const col = [];
            for (let i = 0; i < n; i++) {
                if (activeRows.has(i) && !isNaN(numericData[i][j])) {
                    col.push(numericData[i][j]);
                }
            }
            col.sort((a, b) => a - b);
            const count = col.length;
            if (count === 0) continue;
            const mid = Math.floor(count / 2);
            const median = count % 2 !== 0 ? col[mid] : (col[mid - 1] + col[mid]) / 2;
            const q1 = col[Math.floor(count * 0.25)];
            const q3 = col[Math.floor(count * 0.75)];
            const iqr = (q3 - q1) || 1;
            for (let i = 0; i < n; i++) {
                if (!isNaN(numericData[i][j])) {
                    numericData[i][j] = (numericData[i][j] - median) / iqr;
                }
            }
        }
    } else {
        // 'std' mode: アクティブサンプルの平均・標準偏差
        for (let j = 0; j < p; j++) {
            let sum = 0, count = 0;
            for (let i = 0; i < n; i++) {
                if (activeRows.has(i) && !isNaN(numericData[i][j])) {
                    sum += numericData[i][j];
                    count++;
                }
            }
            const mean = count > 0 ? sum / count : 0;
            
            let sumSq = 0;
            for (let i = 0; i < n; i++) {
                if (activeRows.has(i) && !isNaN(numericData[i][j])) {
                    sumSq += Math.pow(numericData[i][j] - mean, 2);
                }
            }
            const stdDev = Math.sqrt(sumSq / (count > 1 ? count - 1 : 1)) || 1; 
            
            for (let i = 0; i < n; i++) {
                if (!isNaN(numericData[i][j])) {
                    numericData[i][j] = (numericData[i][j] - mean) / stdDev;
                }
            }
        }
    }
}

function renderPreview() {
    const thead = document.querySelector('#preview-table thead');
    const tbody = document.querySelector('#preview-table tbody');
    
    if (!features || features.length === 0) return;
    
    const activeLabels = getActiveLabels();
    const activeNumeric = getActiveNumericData();
    const activeFeatures = getActiveFeatures();
    
    if (activeLabels.length === 0 || activeNumeric.length === 0) return;
    
    const showAll = document.getElementById('show-all-data') ? document.getElementById('show-all-data').checked : false;
    const limit = showAll ? activeLabels.length : Math.min(5, activeLabels.length);
    
    thead.innerHTML = `<tr><th>ラベル</th>${activeFeatures.map(f => `<th>${f}</th>`).join('')}</tr>`;
    tbody.innerHTML = '';
    
    for (let i = 0; i < limit; i++) {
        const tr = document.createElement('tr');
        const rowHTML = `<td><strong>${activeLabels[i]}</strong></td>` + 
                        activeNumeric[i].map(val => `<td>${val.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>`).join('');
        tr.innerHTML = rowHTML;
        tbody.appendChild(tr);
    }
}

function renderStatistics() {
    const tbody = document.querySelector('#stats-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    const activeFeatures = getActiveFeatures();
    const activeLabels = getActiveLabels();
    
    if (!rawNumericData || rawNumericData.length === 0 || !features) return;
    
    const p = features.length;
    
    for (let j = 0; j < p; j++) {
        let min = Infinity, max = -Infinity, sum = 0;
        const colData = [];
        
        for (let i = 0; i < rawNumericData.length; i++) {
            if (!disabledRowIndices.has(i)) {
                const val = rawNumericData[i][j];
                if (!isNaN(val) && val !== null) {
                    colData.push(val);
                    if (val < min) min = val;
                    if (val > max) max = val;
                    sum += val;
                }
            }
        }
        
        colData.sort((a, b) => a - b);
        let median = 0;
        if (colData.length > 0) {
            const mid = Math.floor(colData.length / 2);
            median = colData.length % 2 !== 0 ? colData[mid] : (colData[mid - 1] + colData[mid]) / 2;
        }
        
        const mean = colData.length > 0 ? sum / colData.length : 0;
        let sumSq = 0;
        for (let i = 0; i < colData.length; i++) {
            sumSq += Math.pow(colData[i] - mean, 2);
        }
        const stdDev = Math.sqrt(sumSq / (colData.length > 1 ? colData.length - 1 : 1));
        
        const isChecked = !disabledFeatures.has(features[j]);
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="text-align: center;">
                <input type="checkbox" class="feature-checkbox" data-feature="${features[j]}" ${isChecked ? 'checked' : ''}>
            </td>
            <td><strong>${features[j]}</strong></td>
            <td>${colData.length > 0 ? min.toFixed(2) : '-'}</td>
            <td>${colData.length > 0 ? max.toFixed(2) : '-'}</td>
            <td>${colData.length > 0 ? median.toFixed(2) : '-'}</td>
            <td>${colData.length > 0 ? mean.toFixed(2) : '-'}</td>
            <td>${colData.length > 0 ? stdDev.toFixed(2) : '-'}</td>
        `;
        tbody.appendChild(tr);
    }
    
    tbody.querySelectorAll('.feature-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const feat = e.target.dataset.feature;
            if (e.target.checked) {
                disabledFeatures.delete(feat);
            } else {
                if (getActiveFeatures().length <= 2) {
                    alert("分析を行うには、最低2つの変数が必要です。");
                    e.target.checked = true;
                    return;
                }
                disabledFeatures.add(feat);
            }
            refreshAllVisualizations();
        });
    });
    
    const runPcaBtn = document.getElementById('btn-run-pca');
    if (runPcaBtn) {
        if (activeFeatures.length < 2 || activeLabels.length < 3) {
            runPcaBtn.disabled = true;
            runPcaBtn.style.opacity = '0.5';
            runPcaBtn.style.cursor = 'not-allowed';
        } else {
            runPcaBtn.disabled = false;
            runPcaBtn.style.opacity = '1';
            runPcaBtn.style.cursor = 'pointer';
        }
    }
    
    renderCorrelationHeatmap();
    renderBoxPlots();
    if (currentRelView === 'splom') {
        renderSPLOM();
    }
}

function refreshAllVisualizations() {
    applyStandardization();
    const isResultsVisible = resultsSection && !resultsSection.classList.contains('hidden');
    if (!isResultsVisible) {
        renderPreview();
        renderStatistics();
        renderDataDiagnosis();
    } else {
        // 画面2（ダッシュボード）表示中は、現在の選択状態（軸・クラスタ数）を維持したままPCAを再計算
        runPCA(true);
    }
}

function renderCorrelationHeatmap() {
    const container = document.getElementById('heatmap-container');
    if (!container) return;
    
    const activeFeatures = getActiveFeatures();
    const activeData = getActiveNumericData();
    if (!activeFeatures || activeFeatures.length < 2 || !activeData || activeData.length === 0) return;
    
    const p = activeFeatures.length;
    const zMatrix = [];
    const textMatrix = [];
    const hoverTextMatrix = [];
    const annotations = [];
    
    for (let r = 0; r < p; r++) {
        const zRow = [];
        const textRow = [];
        const hoverRow = [];
        const yData = activeData.map(row => row[r]);
        
        for (let c = 0; c < p; c++) {
            const xData = activeData.map(row => row[c]);
            const corrInfo = calculateCorrelationWithPValue(xData, yData);
            const rVal = corrInfo.r;
            const stars = (r === c) ? '' : corrInfo.stars;
            const valText = rVal.toFixed(2) + stars;
            
            zRow.push(rVal);
            textRow.push(valText);
            
            const pStr = corrInfo.p < 0.001 ? '< 0.001' : corrInfo.p.toFixed(4);
            const methodLabel = corrMethod === 'spearman' ? '順位相関係数 (Spearman ρ)' : '相関係数 (Pearson r)';
            hoverRow.push(`<b>${activeFeatures[r]}</b> vs <b>${activeFeatures[c]}</b><br>${methodLabel}: ${rVal.toFixed(4)}<br>p値: ${pStr}`);
            
            const fontColor = Math.abs(rVal) > 0.65 ? '#ffffff' : '#0f172a';
            annotations.push({
                x: activeFeatures[c],
                y: activeFeatures[r],
                text: `<b>${valText}</b>`,
                font: { color: fontColor, size: p > 6 ? 10 : 12 },
                showarrow: false
            });
        }
        zMatrix.push(zRow);
        textMatrix.push(textRow);
        hoverTextMatrix.push(hoverRow);
    }
    
    const trace = {
        z: zMatrix,
        x: activeFeatures,
        y: activeFeatures,
        hovertext: hoverTextMatrix,
        hoverinfo: 'text',
        type: 'heatmap',
        colorscale: [
            [0, '#2563eb'],
            [0.5, '#f8fafc'],
            [1, '#dc2626']
        ],
        zmin: -1,
        zmax: 1,
        hoverongaps: false,
        colorbar: {
            title: { text: corrMethod === 'spearman' ? '順位相関 ρ' : '相関係数 r', font: { size: 12 } },
            ticks: 'outside',
            len: 0.9
        }
    };
    
    const layout = {
        height: Math.max(380, p * 65),
        margin: { l: 90, r: 90, t: 30, b: 90 },
        yaxis: { autorange: 'reversed' },
        annotations: annotations
    };
    
    Plotly.purge('heatmap-container');
    Plotly.newPlot('heatmap-container', [trace], layout, {responsive: true, displaylogo: false});
}

function renderBoxPlots() {
    const container = document.getElementById('boxplot-container');
    const insightDiv = document.getElementById('boxplot-insight');
    const badgeSpan = document.getElementById('sample-count-badge');
    if (!container) return;
    
    const activeFeatures = getActiveFeatures();
    const activeLabels = getActiveLabels();
    const activeData = getActiveNumericData();
    if (!activeFeatures || activeFeatures.length === 0 || !activeData || activeData.length === 0) return;
    
    if (badgeSpan) {
        const total = labels.length;
        const activeCount = activeLabels.length;
        
        const activeColIndices = [];
        features.forEach((f, i) => {
            if (!disabledFeatures.has(f)) activeColIndices.push(i);
        });
        
        let missingExcludedCount = 0;
        labels.forEach((_, i) => {
            if (!disabledRowIndices.has(i)) {
                for (const cIdx of activeColIndices) {
                    if (isNaN(numericData[i][cIdx]) || numericData[i][cIdx] === null) {
                        missingExcludedCount++;
                        break;
                    }
                }
            }
        });
        
        const manualExcludedCount = disabledRowIndices.size;
        const totalExcluded = manualExcludedCount + missingExcludedCount;
        
        badgeSpan.textContent = `全 ${total} サンプル中 ${activeCount} サンプル分析対象 (手動除外: ${manualExcludedCount}件 / 欠測除外: ${missingExcludedCount}件)`;
        badgeSpan.style.background = totalExcluded > 0 ? '#fef3c7' : '#f1f5f9';
        badgeSpan.style.color = totalExcluded > 0 ? '#92400e' : '#334155';
        badgeSpan.style.borderColor = totalExcluded > 0 ? '#f59e0b' : '#cbd5e1';
    }

    const traces = [];
    const outlierSummary = [];
    detectedOutlierIndices = new Set();
    const activeRowIndices = getActiveRowIndices();
    
    activeFeatures.forEach((feat, j) => {
        const colData = activeData.map(row => row[j]);
        const sortedData = [...colData].sort((a, b) => a - b);
        const n = sortedData.length;
        
        const q1 = sortedData[Math.floor(n * 0.25)];
        const q3 = sortedData[Math.floor(n * 0.75)];
        const iqr = q3 - q1;
        const lowerBound = q1 - 1.5 * iqr;
        const upperBound = q3 + 1.5 * iqr;
        
        const featOutlierLabels = [];
        colData.forEach((val, rIdx) => {
            if (val < lowerBound || val > upperBound) {
                const origIdx = activeRowIndices[rIdx];
                const lblName = activeLabels[rIdx];
                featOutlierLabels.push(lblName);
                detectedOutlierIndices.add(origIdx);
            }
        });
        
        if (featOutlierLabels.length > 0) {
            outlierSummary.push(`「<strong>${feat}</strong>」: ${featOutlierLabels.length}件 (${featOutlierLabels.join('、 ')})`);
        }
        
        traces.push({
            y: colData,
            text: activeLabels,
            name: feat,
            type: 'box',
            boxpoints: 'outliers',
            marker: { color: '#ef4444', size: 6, outliercolor: '#dc2626' },
            line: { color: '#2563eb', width: 1.5 },
            fillcolor: 'rgba(147, 197, 253, 0.35)',
            hovertemplate: '<b>%{text}</b> (%{x})<br>値: %{y:.2f}<extra></extra>'
        });
    });
    
    if (insightDiv) {
        if (outlierSummary.length > 0) {
            insightDiv.style.background = '#f8fafc';
            insightDiv.style.borderLeft = '4px solid #8b5cf6';
            insightDiv.style.color = '#4c1d95';
            insightDiv.innerHTML = `💡 <strong>特徴的なデータ (1.5×IQR基準)</strong>: 以下の変数で、他と比べて際立った値（特異値）を持つサンプルが検出されました。<br>${outlierSummary.join('<br>')}<br><span style="font-size:0.85em; color:#5b21b6; margin-top:0.25rem; display:block;">ℹ️ 麺類が飛び抜けて好きな都市など、これらの特徴的なサンプルに焦点を当てて分析する場合はこのまま進めてください。<br>全体的な一般的な傾向のみを分析したい場合は、上の「⚡ 特徴的なサンプル（特異値）を分析から一括除外」ボタンで除外することも可能です。</span>`;
        } else {
            insightDiv.style.background = '#f0fdf4';
            insightDiv.style.borderLeft = '4px solid #22c55e';
            insightDiv.style.color = '#166534';
            insightDiv.innerHTML = `✅ <strong>分布チェック結果</strong>: 1.5×IQR基準を超える際立った特異値を持つサンプルは検出されませんでした。`;
        }
    }
    
    const yAxisTitles = {
        std: '標準化 Zスコア (Z-Score)',
        log: '対数変換 Zスコア log(X+1)',
        robust: 'ロバストスコア (Median/IQR)',
        none: '測定値 (生データ)'
    };

    const layout = {
        height: 400,
        margin: { l: 60, r: 30, t: 30, b: 60 },
        yaxis: { 
            title: yAxisTitles[transformMode] || '補正スコア',
            zeroline: true
        },
        showlegend: false
    };
    
    Plotly.purge('boxplot-container');
    Plotly.newPlot('boxplot-container', traces, layout, {responsive: true, displaylogo: false});
    renderSampleCheckboxPanel();
}

function renderSampleCheckboxPanel() {
    const container = document.getElementById('sample-checkboxes-container');
    if (!container || !labels || labels.length === 0) return;
    
    const searchVal = (document.getElementById('sample-search-input')?.value || '').toLowerCase().trim();
    container.innerHTML = '';
    
    const activeColIndices = [];
    features.forEach((f, i) => {
        if (!disabledFeatures.has(f)) activeColIndices.push(i);
    });

    labels.forEach((lbl, idx) => {
        const rowNumStr = `#${idx + 1}`;
        if (searchVal && !lbl.toLowerCase().includes(searchVal) && !rowNumStr.includes(searchVal)) return;
        
        let hasMissing = false;
        for (const cIdx of activeColIndices) {
            if (isNaN(numericData[idx][cIdx]) || numericData[idx][cIdx] === null) {
                hasMissing = true;
                break;
            }
        }
        
        const isManuallyDisabled = disabledRowIndices.has(idx);
        const isChecked = !isManuallyDisabled && !hasMissing;
        const isOutlier = detectedOutlierIndices.has(idx);
        
        const labelEl = document.createElement('label');
        labelEl.style.cssText = 'display: flex; align-items: center; font-size: 0.82rem; cursor: pointer; user-select: none; gap: 0.3rem; margin: 0;';
        
        if (hasMissing) {
            labelEl.style.opacity = '0.5';
            labelEl.style.cursor = 'not-allowed';
            labelEl.title = '現在選択中の変数に欠測があるため自動除外されています';
        } else if (isOutlier) {
            labelEl.style.fontWeight = 'bold';
            labelEl.style.color = '#8b5cf6';
        }
        
        labelEl.innerHTML = `
            <input type="checkbox" class="sample-checkbox" data-index="${idx}" ${isChecked ? 'checked' : ''} ${hasMissing ? 'disabled' : ''} style="width: auto; margin-right: 0.2rem;">
            <span><span style="color:var(--text-muted); font-size:0.75rem;">${rowNumStr}</span> ${lbl}</span> 
            ${isOutlier ? '<span title="特徴的な値（特異値）を持つサンプル">💡</span>' : ''}
            ${hasMissing ? '<span title="欠測値あり" style="font-size:0.75rem; background:#cbd5e1; color:white; padding:0 4px; border-radius:3px;">欠測</span>' : ''}
        `;
        container.appendChild(labelEl);
    });
    
    container.querySelectorAll('.sample-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const origIdx = parseInt(e.target.dataset.index);
            if (e.target.checked) {
                disabledRowIndices.delete(origIdx);
            } else {
                if (getActiveLabels().length <= 3) {
                    alert("分析には最低3つのサンプル（データ行）が必要です。");
                    e.target.checked = true;
                    return;
                }
                disabledRowIndices.add(origIdx);
            }
            refreshAllVisualizations();
        });
    });
}

function renderSPLOM() {
    const rawActiveFeatures = getActiveFeatures();
    const rawActiveData = getActiveNumericData();
    if (!rawActiveFeatures || rawActiveFeatures.length < 2 || !rawActiveData || rawActiveData.length === 0) return;
    
    // 表示変数数セレクタに応じた変数の制限設定
    let maxVars = rawActiveFeatures.length;
    if (splomMaxVars !== 'all') {
        const parsed = parseInt(splomMaxVars, 10);
        if (!isNaN(parsed) && parsed > 0) {
            maxVars = parsed;
        }
    }
    
    const isLimited = rawActiveFeatures.length > maxVars;
    const activeFeatures = isLimited ? rawActiveFeatures.slice(0, maxVars) : rawActiveFeatures;
    const activeData = isLimited ? rawActiveData.map(row => row.slice(0, maxVars)) : rawActiveData;
    
    const splomNotice = document.getElementById('splom-description') || document.querySelector('#splom-view-wrapper p');
    if (splomNotice) {
        if (isLimited) {
            splomNotice.innerHTML = `対角線にヒストグラム/密度分布、下三角に散布図と回帰直線、上三角に相関係数を表示します。<br><span style="color:#d97706; font-weight:600;">⚠️ 全${rawActiveFeatures.length}変数中、選択された最初の${maxVars}変数のみを表示しています（右上のセレクタで表示数を変更可能）。</span>`;
        } else {
            splomNotice.innerHTML = `対角線にヒストグラム/密度分布、下三角に散布図と回帰直線、上三角に相関係数と検定スター（p値）を表示します。<br><span style="color:#059669; font-weight:600;">✨ 全${rawActiveFeatures.length}変数を表示中（右上のセレクタで表示数を絞り込み可能）。</span>`;
        }
    }
    
    const activeP = activeFeatures.length;
    const traces = [];
    const shapes = [];
    
    // 変数数に応じた動的レイアウト・スタイリング
    const perCellHeight = activeP <= 6 ? 140 : (activeP <= 10 ? 100 : 85);
    const layoutHeight = Math.max(520, activeP * perCellHeight);
    const marginL = activeP > 10 ? 55 : 65;
    const marginT = activeP > 10 ? 65 : 75;
    const gap = activeP <= 6 ? 0.02 : (activeP <= 10 ? 0.015 : 0.01);
    const titleFontSize = activeP <= 6 ? 12 : (activeP <= 10 ? 10 : 9);
    const corrFontSize = activeP <= 5 ? 16 : (activeP <= 8 ? 12 : (activeP <= 11 ? 10 : 8.5));
    const markerSize = activeP <= 6 ? 5 : (activeP <= 10 ? 4 : 3);
    const regLineWidth = activeP <= 6 ? 2 : 1.5;
    const kdeSteps = activeP >= 8 ? 40 : 100;
    const tickFontSize = activeP <= 8 ? 9 : 8;

    const layout = {
        showlegend: false,
        hovermode: 'closest',
        plot_bgcolor: '#f8fafc',
        paper_bgcolor: '#ffffff',
        margin: {l: marginL, r: 25, b: marginL, t: marginT},
        height: layoutHeight,
    };
    
    for (let r = 0; r < activeP; r++) {
        for (let c = 0; c < activeP; c++) {
            const idx = r * activeP + c + 1;
            const axNameX = idx === 1 ? 'xaxis' : 'xaxis' + idx;
            const axNameY = idx === 1 ? 'yaxis' : 'yaxis' + idx;
            
            const xData = activeData.map(row => row[c]);
            const yData = activeData.map(row => row[r]);
            
            const minX = Math.min(...xData);
            const maxX = Math.max(...xData);
            const minY = Math.min(...yData);
            const maxY = Math.max(...yData);
            const padX = (maxX - minX) * 0.06 || 1;
            const padY = (maxY - minY) * 0.06 || 1;

            const x0 = c / activeP + (c === 0 ? 0 : gap/2);
            const x1 = (c+1)/activeP - (c === activeP-1 ? 0 : gap/2);
            const y0 = 1 - (r+1)/activeP + (r === activeP-1 ? 0 : gap/2);
            const y1 = 1 - r/activeP - (r === 0 ? 0 : gap/2);
            
            let cellBg = '#ffffff';
            if (r === c) {
                cellBg = 'rgba(248, 250, 252, 0.9)';
            } else if (r < c) {
                const corrInfo = calculateCorrelationWithPValue(xData, yData);
                const absR = Math.abs(corrInfo.r);
                if (corrInfo.r > 0) {
                    cellBg = `rgba(239, 68, 68, ${0.05 + absR * 0.45})`;
                } else {
                    cellBg = `rgba(59, 130, 246, ${0.05 + absR * 0.45})`;
                }
            } else {
                cellBg = '#ffffff';
            }

            shapes.push({
                type: 'rect',
                xref: 'paper',
                yref: 'paper',
                x0: x0,
                x1: x1,
                y0: y0,
                y1: y1,
                line: { color: '#cbd5e1', width: 1 },
                fillcolor: cellBg,
                layer: 'below'
            });

            layout[axNameX] = { 
                domain: [x0, x1], 
                showgrid: true,
                gridcolor: '#f1f5f9',
                zeroline: false, 
                showticklabels: r === activeP - 1, 
                side: 'bottom',
                tickangle: 0,
                nticks: 3,
                tickfont: { size: tickFontSize, color: '#64748b' },
                range: [minX - padX, maxX + padX] 
            };
            layout[axNameY] = { 
                domain: [y0, y1], 
                showgrid: true,
                gridcolor: '#f1f5f9',
                zeroline: false, 
                showticklabels: c === 0, 
                nticks: 3,
                tickfont: { size: tickFontSize, color: '#64748b' },
                range: (r === c) ? undefined : [minY - padY, maxY + padY] 
            };
            
            if (r === c) {
                layout[axNameY].showticklabels = false;
            }
            
            if (r === 0) {
                layout[axNameX].side = 'top';
                layout[axNameX].showticklabels = false;
                layout[axNameX].title = { text: `<b>${activeFeatures[c]}</b>`, font: {size: titleFontSize, color: '#1e293b'}, standoff: activeP > 10 ? 8 : 12 };
            }
            if (c === 0) {
                layout[axNameY].title = { text: `<b>${activeFeatures[r]}</b>`, font: {size: titleFontSize, color: '#1e293b'}, standoff: activeP > 10 ? 8 : 12 };
            }
            
            const axisX = 'x' + (idx === 1 ? '' : idx);
            const axisY = 'y' + (idx === 1 ? '' : idx);
            
            if (r === c) {
                // Diagonal: Histogram + KDE line
                traces.push({
                    x: xData,
                    type: 'histogram',
                    histnorm: 'probability density',
                    marker: {color: '#93c5fd', line: {color: 'white', width: 1}},
                    xaxis: axisX,
                    yaxis: axisY,
                    hoverinfo: 'skip'
                });
                
                const kde = calculateKDE(xData, kdeSteps);
                traces.push({
                    x: kde.x,
                    y: kde.y,
                    mode: 'lines',
                    type: 'scatter',
                    line: {color: '#1e3a8a', width: regLineWidth},
                    xaxis: axisX,
                    yaxis: axisY,
                    hoverinfo: 'skip'
                });
            } else if (r < c) {
                // Upper Triangle: Correlation value
                const corrInfo = calculateCorrelationWithPValue(xData, yData);
                const valText = corrInfo.r.toFixed(2) + corrInfo.stars;
                const pStr = corrInfo.p < 0.001 ? '< 0.001' : corrInfo.p.toFixed(4);
                const fontColor = Math.abs(corrInfo.r) > 0.65 ? '#ffffff' : '#0f172a';
                
                traces.push({
                    x: [(minX + maxX) / 2],
                    y: [(minY + maxY) / 2],
                    text: [`<b>${valText}</b>`],
                    mode: 'text',
                    type: 'scatter',
                    textfont: { size: corrFontSize, color: fontColor },
                    xaxis: axisX,
                    yaxis: axisY,
                    hoverinfo: 'text',
                    hovertext: `相関係数: ${corrInfo.r.toFixed(4)}<br>p値: ${pStr}<extra></extra>`
                });
            } else {
                // Lower Triangle: Scatter plot + Linear Regression Trendline
                traces.push({
                    x: xData,
                    y: yData,
                    mode: 'markers',
                    type: 'scatter',
                    marker: { color: 'rgba(37, 99, 235, 0.65)', size: markerSize, line: {color: 'white', width: 0.5} },
                    xaxis: axisX,
                    yaxis: axisY,
                    text: getActiveLabels(),
                    hovertemplate: '%{text}<br>X: %{x:.2f}<br>Y: %{y:.2f}<extra></extra>'
                });
                
                const reg = calculateLinearRegression(xData, yData);
                traces.push({
                    x: [minX, maxX],
                    y: [reg.m * minX + reg.b, reg.m * maxX + reg.b],
                    mode: 'lines',
                    type: 'scatter',
                    line: { color: '#dc2626', width: regLineWidth },
                    xaxis: axisX,
                    yaxis: axisY,
                    hoverinfo: 'skip'
                });
            }
        }
    }
    layout.shapes = shapes;
    
    Plotly.purge('splom-container');
    Plotly.newPlot('splom-container', traces, layout, {responsive: true, displaylogo: false});
}

function normalCDF(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp(-z * z / 2);
    const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - prob : prob;
}

function calculatePearsonWithPValue(x, y) {
    const n = x.length;
    if (n < 3) return { r: 0, p: 1, stars: '' };
    let sum_x = 0, sum_y = 0, sum_xy = 0, sum_x2 = 0, sum_y2 = 0;
    for(let i = 0; i < n; i++) {
        sum_x += x[i];
        sum_y += y[i];
        sum_xy += x[i] * y[i];
        sum_x2 += x[i] * x[i];
        sum_y2 += y[i] * y[i];
    }
    const num = n * sum_xy - sum_x * sum_y;
    const den = Math.sqrt((n * sum_x2 - sum_x * sum_x) * (n * sum_y2 - sum_y * sum_y));
    if (den === 0) return { r: 0, p: 1, stars: '' };
    
    const r = Math.max(-1, Math.min(1, num / den));
    const df = n - 2;
    const absR = Math.abs(r);
    if (absR >= 0.99999) return { r: r, p: 0, stars: '***' };
    
    const t = absR * Math.sqrt(df / (1 - absR * absR));
    let p;
    if (df === 1) {
        // コーシー分布の厳密両側p値: 2 * (0.5 - arctan(t)/pi)
        p = 2 * (0.5 - Math.atan(t) / Math.PI);
    } else if (df === 2) {
        // df=2 の厳密両側p値: 2 * (0.5 - t / (2 * sqrt(2 + t^2)))
        p = 2 * (0.5 - t / (2 * Math.sqrt(2 + t * t)));
    } else {
        const z = (1 - 1 / (4 * df)) * t / Math.sqrt(1 + t * t / (2 * df));
        p = 2 * (1 - normalCDF(Math.abs(z)));
    }
    p = Math.max(0, Math.min(1, p));
    
    let stars = '';
    if (p < 0.001) stars = '***';
    else if (p < 0.01) stars = '**';
    else if (p < 0.05) stars = '*';
    else if (p < 0.1) stars = '.';
    
    return { r, p, stars };
}

function calculateCorrelationWithPValue(x, y) {
    if (typeof corrMethod !== 'undefined' && corrMethod === 'spearman') {
        return calculateSpearmanWithPValue(x, y);
    }
    return calculatePearsonWithPValue(x, y);
}

function calculateSpearmanWithPValue(x, y) {
    const getRanks = (arr) => {
        const sorted = arr.map((v, i) => ({v, i})).sort((a, b) => a.v - b.v);
        const ranks = new Array(arr.length);
        let i = 0;
        while (i < sorted.length) {
            let j = i;
            while (j < sorted.length - 1 && sorted[j].v === sorted[j+1].v) j++;
            const avgRank = (i + j + 2) / 2.0; // 1-based index
            for (let k = i; k <= j; k++) {
                ranks[sorted[k].i] = avgRank;
            }
            i = j + 1;
        }
        return ranks;
    };
    return calculatePearsonWithPValue(getRanks(x), getRanks(y));
}

function calculatePearson(x, y) {
    return calculatePearsonWithPValue(x, y).r;
}

function calculateLinearRegression(x, y) {
    const n = x.length;
    if (n === 0) return { m: 0, b: 0 };
    let sum_x = 0, sum_y = 0, sum_xy = 0, sum_x2 = 0;
    for(let i=0; i<n; i++) {
        sum_x += x[i];
        sum_y += y[i];
        sum_xy += x[i]*y[i];
        sum_x2 += x[i]*x[i];
    }
    const den = n*sum_x2 - sum_x*sum_x;
    if (Math.abs(den) < 1e-12) {
        return { m: 0, b: sum_y / n };
    }
    const m = (n*sum_xy - sum_x*sum_y) / den;
    const b = (sum_y - m*sum_x) / n;
    return {m, b};
}

function calculateKDE(data, steps=100) {
    const n = data.length;
    if (n === 0) return { x: [], y: [] };
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min;
    const padding = range > 1e-12 ? range * 0.1 : 1.0;
    const xStart = min - padding;
    const xEnd = max + padding;
    const stepSize = (xEnd - xStart) / steps;
    
    let sum = 0;
    data.forEach(v => sum += v);
    const mean = sum/n;
    let sumSq = 0;
    data.forEach(v => sumSq += (v-mean)*(v-mean));
    const std = Math.sqrt(sumSq/n);
    const effectiveStd = std > 1e-8 ? std : 0.5;
    const h = 1.06 * effectiveStd * Math.pow(n, -0.2); 
    
    const xOut = [];
    const yOut = [];
    
    for(let i=0; i<=steps; i++) {
        const xVal = xStart + i * stepSize;
        let density = 0;
        for(let j=0; j<n; j++) {
            const u = (xVal - data[j]) / h;
            density += Math.exp(-0.5 * u * u) / (Math.sqrt(2 * Math.PI));
        }
        density = density / (n * h);
        xOut.push(xVal);
        yOut.push(density);
    }
    return {x: xOut, y: yOut};
}

function kMeans(data, k, maxIter = 100) {
    const n = data.length;
    if (k <= 1 || n === 0) return { clusters: Array(n).fill(0) };
    const p = data[0].length;
    
    // k-means++ による初期重心の選択
    const centroids = [];
    const firstIdx = Math.floor(Math.random() * n);
    centroids.push([...data[firstIdx]]);
    
    for (let c = 1; c < k; c++) {
        const distSq = new Array(n);
        let sumDistSq = 0;
        for (let i = 0; i < n; i++) {
            let minD = Infinity;
            for (let j = 0; j < centroids.length; j++) {
                let d = 0;
                for (let dIdx = 0; dIdx < p; dIdx++) {
                    const diff = data[i][dIdx] - centroids[j][dIdx];
                    d += diff * diff;
                }
                if (d < minD) minD = d;
            }
            distSq[i] = minD;
            sumDistSq += minD;
        }
        
        if (sumDistSq <= 1e-12) {
            centroids.push([...data[Math.floor(Math.random() * n)]]);
            continue;
        }
        
        let target = Math.random() * sumDistSq;
        let chosenIdx = n - 1;
        for (let i = 0; i < n; i++) {
            target -= distSq[i];
            if (target <= 0) {
                chosenIdx = i;
                break;
            }
        }
        centroids.push([...data[chosenIdx]]);
    }
    
    let clusters = new Array(n).fill(0);
    for (let iter = 0; iter < maxIter; iter++) {
        let changed = false;
        for (let i = 0; i < n; i++) {
            let minD = Infinity, bestC = 0;
            for (let c = 0; c < k; c++) {
                let d = 0;
                for (let j = 0; j < p; j++) {
                    const diff = data[i][j] - centroids[c][j];
                    d += diff * diff;
                }
                if (d < minD) { minD = d; bestC = c; }
            }
            if (clusters[i] !== bestC) {
                clusters[i] = bestC;
                changed = true;
            }
        }
        if (!changed) break;
        
        const sums = Array.from({ length: k }, () => new Array(p).fill(0));
        const counts = new Array(k).fill(0);
        for (let i = 0; i < n; i++) {
            const cl = clusters[i];
            counts[cl]++;
            for (let j = 0; j < p; j++) sums[cl][j] += data[i][j];
        }
        
        for (let c = 0; c < k; c++) {
            if (counts[c] > 0) {
                for (let j = 0; j < p; j++) centroids[c][j] = sums[c][j] / counts[c];
            } else {
                // 空クラスタ回復: 現在の重心から最も遠いデータ点を割り当てる
                let maxD = -1, furthestIdx = 0;
                for (let i = 0; i < n; i++) {
                    let d = 0;
                    const cl = clusters[i];
                    for (let j = 0; j < p; j++) {
                        const diff = data[i][j] - centroids[cl][j];
                        d += diff * diff;
                    }
                    if (d > maxD) {
                        maxD = d;
                        furthestIdx = i;
                    }
                }
                centroids[c] = [...data[furthestIdx]];
            }
        }
    }
    return { clusters };
}

function kMeansBest(data, k, nInit = 20) {
    if (k <= 1 || data.length === 0) return { clusters: Array(data.length).fill(0) };
    let bestWCSS = Infinity;
    let bestResult = null;
    for (let trial = 0; trial < nInit; trial++) {
        const res = kMeans(data, k);
        const wcss = calculateWCSS(data, res.clusters, k);
        if (wcss < bestWCSS) {
            bestWCSS = wcss;
            bestResult = res;
        }
    }
    return bestResult || kMeans(data, k);
}

function calculateWCSS(data, clusters, k) {
    let centroids = Array(k).fill(0).map(()=>Array(data[0].length).fill(0));
    let counts = Array(k).fill(0);
    for(let i=0; i<data.length; i++) {
        counts[clusters[i]]++;
        for(let j=0; j<data[i].length; j++) centroids[clusters[i]][j] += data[i][j];
    }
    for(let c=0; c<k; c++) {
        if(counts[c]>0) for(let j=0; j<centroids[c].length; j++) centroids[c][j] /= counts[c];
    }
    let wcss = 0;
    for(let i=0; i<data.length; i++) {
        for(let j=0; j<data[i].length; j++) wcss += Math.pow(data[i][j] - centroids[clusters[i]][j], 2);
    }
    return wcss;
}

function determineOptimalK(data) {
    if (!data || data.length < 4) return { optimalK: 1, wcss: [0] };
    let wcss = [];
    let maxK = Math.min(10, data.length - 1);
    for (let k = 1; k <= maxK; k++) {
        let best_w = Infinity;
        for (let r = 0; r < 10; r++) {
            let res = kMeans(data, k);
            let w = calculateWCSS(data, res.clusters, k);
            if (w < best_w) best_w = w;
        }
        // WCSSの単調減少性を保証
        if (wcss.length > 0 && best_w > wcss[wcss.length - 1]) {
            best_w = wcss[wcss.length - 1];
        }
        wcss.push(best_w);
    }
    
    // Kneedle幾何学的エルボー判定 (直線からの垂直乖離最大点)
    let bestK = 2;
    if (wcss.length > 2) {
        const w1 = wcss[0];
        const wMax = wcss[wcss.length - 1];
        const denom = (w1 - wMax);
        if (denom > 1e-12) {
            let maxDist = -Infinity;
            for (let k = 2; k <= wcss.length - 1; k++) {
                const x = (k - 1) / (wcss.length - 1);
                const y = (wcss[k - 1] - wMax) / denom;
                // 対角直線 y = 1 - x からの垂直距離 (1 - x) - y
                const dist = (1 - x) - y;
                if (dist > maxDist) {
                    maxDist = dist;
                    bestK = k;
                }
            }
        }
    } else if (wcss.length === 2) {
        bestK = 2;
    } else {
        bestK = 1;
    }

    const finalK = Math.max(1, Math.min(bestK, maxK));
    return { optimalK: finalK, wcss: wcss };
}


// 実対称行列専用のヤコビ法による高精度・完全実数固有値計算
function jacobiEigenvalues(matrix, maxIter = null) {
    const n = matrix.length;
    // 非対角ペア数 n*(n-1)/2 に対し、十分な回転数（最大100スイープ相当、最低1000回）を確保
    const effectiveMaxIter = maxIter !== null ? maxIter : Math.max(1000, n * n * 50);
    let A = matrix.map(r => [...r]);
    let V = Array.from({ length: n }, (_, i) => {
        const row = new Array(n).fill(0);
        row[i] = 1;
        return row;
    });

    for (let iter = 0; iter < effectiveMaxIter; iter++) {
        let maxVal = 0;
        let p = 0, q = 1;
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                const absVal = Math.abs(A[i][j]);
                if (absVal > maxVal) {
                    maxVal = absVal;
                    p = i;
                    q = j;
                }
            }
        }
        if (maxVal < 1e-14) break;

        const app = A[p][p];
        const aqq = A[q][q];
        const apq = A[p][q];

        const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
        const c = Math.cos(phi);
        const s = Math.sin(phi);

        for (let k = 0; k < n; k++) {
            if (k !== p && k !== q) {
                const akp = A[k][p];
                const akq = A[k][q];
                A[k][p] = A[p][k] = c * akp - s * akq;
                A[k][q] = A[q][k] = s * akp + c * akq;
            }
        }
        A[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
        A[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
        A[p][q] = A[q][p] = 0;

        for (let k = 0; k < n; k++) {
            const vkp = V[k][p];
            const vkq = V[k][q];
            V[k][p] = c * vkp - s * vkq;
            V[k][q] = s * vkp + c * vkq;
        }
    }

    const values = [];
    const vectors = [];
    for (let i = 0; i < n; i++) {
        values.push(Math.max(0, A[i][i]));
        vectors.push(V.map(row => row[i]));
    }
    return { values, vectors };
}

function runPCA(preserveState = false) {
    try {
        const activeFeatures = getActiveFeatures();
        const activeLabels = getActiveLabels();
        const X = getActiveNumericData();
        
        if (activeFeatures.length < 2) {
            alert("主成分分析を実行するには、少なくとも2つ以上の変数を選択してください。");
            return;
        }
        if (activeLabels.length < 3) {
            alert("主成分分析を実行するには、少なくとも3つ以上のサンプル（データ行）を選択してください。");
            return;
        }
        
        // 状態退避（preserveState時）
        const savedX = (preserveState && axisXSelect) ? axisXSelect.value : null;
        const savedY = (preserveState && axisYSelect) ? axisYSelect.value : null;
        const savedZ = (preserveState && axisZSelect) ? axisZSelect.value : null;
        const savedK = (preserveState && clusterCount) ? parseInt(clusterCount.value) : null;
        
        const n = X.length;
        const p = X[0].length;
        
        // データの中心化 (共分散行列の計算用)
        const Xc = [];
        const means = [];
        for (let j = 0; j < p; j++) {
            let sum = 0;
            for (let i = 0; i < n; i++) sum += X[i][j];
            means.push(sum / n);
        }
        for (let i = 0; i < n; i++) {
            Xc.push([...X[i]]);
            for (let j = 0; j < p; j++) {
                Xc[i][j] -= means[j];
            }
        }
        
        // 中心化済みデータを用いて共分散行列を計算
        const cov = numeric.dot(numeric.transpose(Xc), Xc);
        for (let i = 0; i < p; i++) {
            for (let j = 0; j < p; j++) cov[i][j] /= (n - 1);
        }
        
        // 対称ヤコビ法により実固有値と直交固有ベクトルを厳密計算
        const eigRes = jacobiEigenvalues(cov);
        
        const ev = [];
        for (let i = 0; i < p; i++) {
            ev.push({
                val: eigRes.values[i],
                vec: eigRes.vectors[i]
            });
        }
        ev.sort((a, b) => b.val - a.val);
        
        const eigenValues = ev.map(x => x.val);
        const eigenVectors = numeric.transpose(ev.map(x => x.vec));
        
        const totalVar = eigenValues.reduce((a, b) => a + b, 0) || 1;
        const explainedVar = eigenValues.map(v => v / totalVar);
        
        const scores = numeric.dot(Xc, eigenVectors);
        
        // 因子負荷量 (Factor Loadings) の計算:
        // 各変数の標準偏差 s_i を算出し、相関係数 [-1, 1] として正規化
        const stdDevs = [];
        for (let j = 0; j < p; j++) {
            let sumSq = 0;
            for (let i = 0; i < n; i++) sumSq += Xc[i][j] * Xc[i][j];
            stdDevs.push(Math.sqrt(sumSq / (n > 1 ? n - 1 : 1)));
        }
        
        const factorLoadings = [];
        for (let i = 0; i < p; i++) {
            factorLoadings[i] = [];
            const s_i = stdDevs[i];
            for (let j = 0; j < p; j++) {
                const rawL = eigenVectors[i][j] * Math.sqrt(Math.max(0, eigenValues[j]));
                const corr = (s_i > 1e-12) ? rawL / s_i : 0;
                factorLoadings[i][j] = Math.max(-1, Math.min(1, corr));
            }
        }
        
        // 主成分ベクトルの符号揃え (Sign Alignment):
        // 各主成分 j について、最大絶対値を持つ変数の符号または負荷量合計が負の場合、
        // 固有ベクトル、因子負荷量、主成分得点の符号を一括反転し、主軸の向きを直感的に統一
        for (let j = 0; j < p; j++) {
            let sumLoading = 0;
            let maxAbsLoading = -1;
            let signOfMax = 1;
            for (let i = 0; i < p; i++) {
                const l = factorLoadings[i][j];
                sumLoading += l;
                if (Math.abs(l) > maxAbsLoading) {
                    maxAbsLoading = Math.abs(l);
                    signOfMax = l >= 0 ? 1 : -1;
                }
            }
            const shouldFlip = (Math.abs(sumLoading) > 0.05) ? (sumLoading < 0) : (signOfMax < 0);
            if (shouldFlip) {
                for (let i = 0; i < p; i++) {
                    eigenVectors[i][j] *= -1;
                    factorLoadings[i][j] *= -1;
                }
                for (let i = 0; i < n; i++) {
                    scores[i][j] *= -1;
                }
            }
        }
        
        pcaResult = {
            X: X,
            labels: activeLabels,
            features: activeFeatures,
            scores: scores,
            loadings: factorLoadings,
            eigenVectors: eigenVectors,
            explainedVar: explainedVar,
            eigenValues: eigenValues,
            clusters: [],
            optimalK: 3,
            wcss: []
        };
        
        setupSelects(p);
        
        if (preserveState) {
            if (savedX !== null && parseInt(savedX) < p) axisXSelect.value = savedX;
            if (savedY !== null && parseInt(savedY) < p) axisYSelect.value = savedY;
            if (savedZ !== null && axisZSelect && parseInt(savedZ) < p) axisZSelect.value = savedZ;
        }
        prevAxisX = axisXSelect.value;
        prevAxisY = axisYSelect.value;
        if (axisZSelect) prevAxisZ = axisZSelect.value;

        // クラスタ対象空間に応じたデータで最適クラスタ数を算出
        const dataForClustering = getClusteringInputData(pcaResult);
        const optKInfo = determineOptimalK(dataForClustering);
        const optimalK = optKInfo.optimalK;
        pcaResult.optimalK = optimalK;
        pcaResult.wcss = optKInfo.wcss;
        
        updateOptimalKUI(optimalK);
        
        const autoOptCb = document.getElementById('auto-optimal-k');
        const isAutoOptimal = autoOptCb ? autoOptCb.checked : true;
        const effectiveK = (!isAutoOptimal && preserveState && savedK) 
            ? Math.min(savedK, Math.min(10, n - 1)) 
            : optimalK;
        
        if (clusterCount) clusterCount.value = effectiveK;
        const clusterValSpan = document.getElementById('cluster-value');
        if (clusterValSpan) clusterValSpan.textContent = effectiveK;
        
        // スライダー増減ボタンの状態を更新
        const decBtn = document.getElementById('btn-cluster-count-dec');
        const incBtn = document.getElementById('btn-cluster-count-inc');
        if (decBtn && incBtn && clusterCount) {
            decBtn.disabled = effectiveK <= parseFloat(clusterCount.min || 1);
            incBtn.disabled = effectiveK >= parseFloat(clusterCount.max || 10);
        }

        // クラスタリングの計算（clusterSpace および clusterMethod に応じて）
        if (clusterMethod === 'dbscan') {
            autoConfigureDBSCAN(false);
            const epsInput = document.getElementById('dbscan-eps');
            const minPtsInput = document.getElementById('dbscan-min-pts');
            const eps = epsInput ? parseFloat(epsInput.value) : dbscanEps;
            const minPts = minPtsInput ? parseInt(minPtsInput.value) : dbscanMinPts;
            const dbRes = runDBSCAN(dataForClustering, eps, minPts);
            pcaResult.clusters = dbRes.labels;
            pcaResult.dbscanStats = {
                numClusters: dbRes.numClusters,
                numNoise: dbRes.numNoise
            };
            updateDBSCANSummaryUI();
        } else {
            pcaResult.clusters = kMeansBest(dataForClustering, effectiveK).clusters;
        }
        
        // Show results section first so container dimensions are valid
        uploadSection.classList.add('hidden');
        resultsSection.classList.remove('hidden');
        
        // Render charts once
        updatePlot();
        renderScreePlot();
        renderElbowPlot();
        renderLoadingsChart();
        
    } catch (e) {
        console.error(e);
        alert("分析中にエラーが発生しました。データの形式を確認してください。");
    }
}

function setupSelects(numComponents) {
    const maxComp = numComponents; 
    
    axisXSelect.innerHTML = '';
    axisYSelect.innerHTML = '';
    if (axisZSelect) axisZSelect.innerHTML = '';
    
    for (let i = 0; i < maxComp; i++) {
        const option1 = document.createElement('option');
        option1.value = i;
        option1.textContent = `第${i+1}主成分 (PC${i+1})`;
        if (i === 0) option1.selected = true;
        axisXSelect.appendChild(option1);
        
        const option2 = document.createElement('option');
        option2.value = i;
        option2.textContent = `第${i+1}主成分 (PC${i+1})`;
        if (i === 1) option2.selected = true;
        axisYSelect.appendChild(option2);
        
        if (axisZSelect) {
            const option3 = document.createElement('option');
            option3.value = i;
            option3.textContent = `第${i+1}主成分 (PC${i+1})`;
            if (i === 2 || (i === 1 && maxComp < 3)) option3.selected = true;
            axisZSelect.appendChild(option3);
        }
    }
}

function updatePlot() {
    if (!pcaResult) return;
    
    const is3D = document.getElementById('enable-3d') ? document.getElementById('enable-3d').checked : false;
    
    const xIdx = parseInt(axisXSelect.value);
    const yIdx = parseInt(axisYSelect.value);
    const zIdx = (is3D && document.getElementById('axis-z-select')) ? parseInt(document.getElementById('axis-z-select').value) : 0;
    
    const varX = (pcaResult.explainedVar[xIdx] * 100).toFixed(1);
    const varY = (pcaResult.explainedVar[yIdx] * 100).toFixed(1);
    const varZ = is3D ? (pcaResult.explainedVar[zIdx] * 100).toFixed(1) : "0";
    
    const scoresX = pcaResult.scores.map(row => row[xIdx]);
    const scoresY = pcaResult.scores.map(row => row[yIdx]);
    const scoresZ = is3D ? pcaResult.scores.map(row => row[zIdx]) : [];
    
    const loadingsX = pcaResult.loadings.map(row => row[xIdx]);
    const loadingsY = pcaResult.loadings.map(row => row[yIdx]);
    const loadingsZ = is3D ? pcaResult.loadings.map(row => row[zIdx]) : [];
    
    const topX = getTopContributors(loadingsX);
    const topY = getTopContributors(loadingsY);
    const topZ = is3D ? getTopContributors(loadingsZ) : "";
    
    const showLabels = document.getElementById('show-labels') ? document.getElementById('show-labels').checked : true;
    const showVectors = document.getElementById('show-vectors') ? document.getElementById('show-vectors').checked : true;
    const enableClustering = document.getElementById('enable-clustering') ? document.getElementById('enable-clustering').checked : true;
    const plotLabels = pcaResult.labels || getActiveLabels();
    
    const globalPositions = [];
    if (showLabels && !is3D) {
        const xMin = Math.min(...scoresX);
        const xMax = Math.max(...scoresX);
        const yMin = Math.min(...scoresY);
        const yMax = Math.max(...scoresY);
        const threshold = Math.max((xMax - xMin), (yMax - yMin)) * 0.05; 
        const thresholdSq = threshold * threshold;
        
        for (let i = 0; i < scoresX.length; i++) {
            let nearestDist = Infinity;
            let nearestIdx = -1;
            for (let j = 0; j < scoresX.length; j++) {
                if (i === j) continue;
                const dx = scoresX[i] - scoresX[j];
                const dy = scoresY[i] - scoresY[j];
                const dist = dx*dx + dy*dy;
                if (dist < nearestDist) {
                    nearestDist = dist;
                    nearestIdx = j;
                }
            }
            if (nearestIdx !== -1 && nearestDist < thresholdSq) {
                const dx = scoresX[i] - scoresX[nearestIdx];
                const dy = scoresY[i] - scoresY[nearestIdx];
                if (Math.abs(dx) > Math.abs(dy)) {
                    globalPositions.push(dx > 0 ? 'middle right' : 'middle left');
                } else {
                    globalPositions.push(dy > 0 ? 'top center' : 'bottom center');
                }
            } else {
                globalPositions.push('top center');
            }
        }
    }

    const traces = [];
    
    const colors = [
        '#3b82f6', // blue
        '#10b981', // emerald
        '#f59e0b', // amber
        '#8b5cf6', // purple
        '#ec4899', // pink
        '#06b6d4', // cyan
        '#84cc16', // lime
        '#ea580c', // orange
        '#6366f1', // indigo
        '#14b8a6'  // teal
    ];
    if (!enableClustering) {
        const trace = {
            x: scoresX,
            y: scoresY,
            mode: showLabels ? 'markers+text' : 'markers',
            type: is3D ? 'scatter3d' : 'scatter',
            name: 'データ点',
            text: plotLabels,
            marker: { 
                size: is3D ? 6 : 10, 
                color: colors[0], 
                opacity: 0.95,
                line: { color: '#ffffff', width: is3D ? 0 : 1.5 }
            },
            textfont: { size: 11, color: '#1e293b' }
        };
        if (is3D) trace.z = scoresZ;
        if (!is3D && showLabels) trace.textposition = globalPositions;
        traces.push(trace);
    } else {
        const uniqueClusters = Array.from(new Set(pcaResult.clusters));
        const normalClusters = uniqueClusters.filter(c => c >= 0).sort((a, b) => a - b);
        const hasNoise = uniqueClusters.includes(-1);

        // 1. 通常クラスタの描画
        for (let idx = 0; idx < normalClusters.length; idx++) {
            const c = normalClusters[idx];
            const cX = [], cY = [], cZ = [], cText = [], cPos = [];
            for (let i = 0; i < pcaResult.clusters.length; i++) {
                if (pcaResult.clusters[i] === c) {
                    cX.push(scoresX[i]);
                    cY.push(scoresY[i]);
                    if (is3D) cZ.push(scoresZ[i]);
                    cText.push(plotLabels[i]);
                    if (showLabels && !is3D) cPos.push(globalPositions[i]);
                }
            }
            if (cX.length > 0) {
                if (!is3D) {
                    const ellipse = getEllipsePoints(cX, cY, 100, 2.0);
                    if (ellipse) {
                        traces.push({
                            x: ellipse.x,
                            y: ellipse.y,
                            mode: 'lines',
                            type: 'scatter',
                            name: `クラスタ ${c + 1} 領域`,
                            line: { color: colors[c % colors.length], width: 1.5 },
                            fill: 'toself',
                            fillcolor: colors[c % colors.length],
                            opacity: 0.12,
                            showlegend: false,
                            hoverinfo: 'skip'
                        });
                    }
                }

                const trace = {
                    x: cX,
                    y: cY,
                    mode: showLabels ? 'markers+text' : 'markers',
                    type: is3D ? 'scatter3d' : 'scatter',
                    name: `クラスタ ${c + 1}`,
                    text: cText,
                    marker: { 
                        size: is3D ? 6 : 10, 
                        color: colors[c % colors.length], 
                        opacity: 0.95,
                        line: { color: '#ffffff', width: is3D ? 0 : 1.5 }
                    },
                    textfont: { size: 11, color: '#1e293b' }
                };
                if (is3D) trace.z = cZ;
                if (!is3D && showLabels) trace.textposition = cPos;
                traces.push(trace);
            }
        }

        // 2. ノイズ点（外れ値）の描画 (DBSCAN時)
        if (hasNoise) {
            const nX = [], nY = [], nZ = [], nText = [], nPos = [];
            for (let i = 0; i < pcaResult.clusters.length; i++) {
                if (pcaResult.clusters[i] === -1) {
                    nX.push(scoresX[i]);
                    nY.push(scoresY[i]);
                    if (is3D) nZ.push(scoresZ[i]);
                    nText.push(plotLabels[i]);
                    if (showLabels && !is3D) nPos.push(globalPositions[i]);
                }
            }
            if (nX.length > 0) {
                const noiseTrace = {
                    x: nX,
                    y: nY,
                    mode: showLabels ? 'markers+text' : 'markers',
                    type: is3D ? 'scatter3d' : 'scatter',
                    name: '⚠️ 外れ値 (ノイズ)',
                    text: nText,
                    marker: { 
                        size: is3D ? 7 : 11, 
                        color: '#64748b', 
                        symbol: is3D ? 'circle' : 'x',
                        opacity: 0.85,
                        line: { color: '#475569', width: 2 }
                    },
                    textfont: { size: 11, color: '#64748b' }
                };
                if (is3D) noiseTrace.z = nZ;
                if (!is3D && showLabels) noiseTrace.textposition = nPos;
                traces.push(noiseTrace);
            }
        }
    }
    
    const maxX = Math.max(...scoresX.map(Math.abs));
    const maxY = Math.max(...scoresY.map(Math.abs));
    const maxZ = is3D ? Math.max(...scoresZ.map(Math.abs)) : 0;
    const maxScore = Math.max(maxX, Math.max(maxY, maxZ)) || 1;
    
    const maxLoading = Math.max(...loadingsX.map(Math.abs), ...loadingsY.map(Math.abs), ...(is3D ? loadingsZ.map(Math.abs) : [0])) || 1;
    const scalingFactor = (maxScore / maxLoading) * 0.8 * currentScale;
    
    const annotations = [];
    
    if (showVectors) {
        const activeFeatures = getActiveFeatures();
        
        if (is3D) {
            const vecX = [], vecY = [], vecZ = [], vecText = [];
            for (let i = 0; i < activeFeatures.length; i++) {
                const lx = loadingsX[i] * scalingFactor;
                const ly = loadingsY[i] * scalingFactor;
                const lz = loadingsZ[i] * scalingFactor;
                
                traces.push({
                    x: [0, lx],
                    y: [0, ly],
                    z: [0, lz],
                    mode: 'lines',
                    type: 'scatter3d',
                    line: { color: '#ef4444', width: 4 },
                    showlegend: false,
                    hoverinfo: 'skip'
                });
                
                vecX.push(lx);
                vecY.push(ly);
                vecZ.push(lz);
                vecText.push(`<b>${activeFeatures[i]}</b>`);
            }
            
            traces.push({
                x: vecX,
                y: vecY,
                z: vecZ,
                mode: 'text',
                type: 'scatter3d',
                text: vecText,
                textfont: { color: '#dc2626', size: 12 },
                showlegend: false,
                hoverinfo: 'skip'
            });
            
        } else {
            const vecData = [];
            for (let i = 0; i < activeFeatures.length; i++) {
                const lx = loadingsX[i] * scalingFactor;
                const ly = loadingsY[i] * scalingFactor;
                const angle = Math.atan2(ly, lx);
                const dist = Math.sqrt(lx * lx + ly * ly);
                vecData.push({
                    feature: activeFeatures[i],
                    lx: lx,
                    ly: ly,
                    angle: angle,
                    dist: dist,
                    rawIdx: i
                });
            }

            vecData.sort((a, b) => a.angle - b.angle);

            for (let k = 0; k < vecData.length; k++) {
                const current = vecData[k];
                let sameClusterIndex = 0;
                for (let j = k - 1; j >= 0; j--) {
                    let diff = Math.abs(current.angle - vecData[j].angle);
                    if (diff > Math.PI) diff = 2 * Math.PI - diff;
                    if (diff < 0.25) { 
                        sameClusterIndex++;
                    } else {
                        break;
                    }
                }
                current.staggerIndex = sameClusterIndex;
            }

            for (let k = 0; k < vecData.length; k++) {
                const v = vecData[k];
                const lx = v.lx;
                const ly = v.ly;
                
                annotations.push({
                    x: lx,
                    y: ly,
                    ax: 0,
                    ay: 0,
                    xref: 'x',
                    yref: 'y',
                    axref: 'x',
                    ayref: 'y',
                    showarrow: true,
                    arrowcolor: '#ef4444',
                    arrowhead: 2, 
                    arrowsize: 1.5,
                    arrowwidth: 2,
                    standoff: 0,
                    startstandoff: 0
                });

                const baseShiftX = lx >= 0 ? 8 : -8;
                const baseShiftY = ly >= 0 ? 8 : -8;
                const staggerStep = v.staggerIndex * 20;
                const extraX = Math.abs(lx) > Math.abs(ly) ? 0 : (lx >= 0 ? staggerStep : -staggerStep);
                const extraY = Math.abs(lx) > Math.abs(ly) ? (ly >= 0 ? staggerStep : -staggerStep) : (ly >= 0 ? staggerStep : -staggerStep);

                annotations.push({
                    x: lx,
                    y: ly,
                    xref: 'x',
                    yref: 'y',
                    text: `<b>${v.feature}</b>`,
                    showarrow: false,
                    font: { color: '#dc2626', size: 11 },
                    xanchor: lx >= 0 ? 'left' : 'right',
                    yanchor: ly >= 0 ? 'bottom' : 'top',
                    xshift: baseShiftX + extraX,
                    yshift: baseShiftY + extraY,
                    bgcolor: 'rgba(255, 255, 255, 0.92)',
                    bordercolor: '#fca5a5',
                    borderwidth: 1,
                    borderpad: 3
                });
            }

            traces.push({
                x: vecData.map(v => v.lx),
                y: vecData.map(v => v.ly),
                mode: 'markers',
                type: 'scatter',
                name: 'ベクトル情報',
                marker: { size: 10, color: '#ef4444', opacity: 0.01 },
                text: vecData.map(v => `<b>${v.feature}</b><br>PC${xIdx+1} 因子負荷量: ${loadingsX[v.rawIdx].toFixed(2)}<br>PC${yIdx+1} 因子負荷量: ${loadingsY[v.rawIdx].toFixed(2)}`),
                hoverinfo: 'text',
                showlegend: false
            });
        }
    }
    
    const customTitle = plotTitleInput ? plotTitleInput.value : 'PCA バイプロット';
    
    let layout = {
        title: customTitle,
        margin: {l: 60, r: 50, b: 70, t: 50}
    };
    
    if (is3D) {
        layout.scene = {
            xaxis: { title: `PC${xIdx+1} (${varX}%)`, zeroline: true },
            yaxis: { title: `PC${yIdx+1} (${varY}%)`, zeroline: true },
            zaxis: { title: `PC${zIdx+1} (${varZ}%)`, zeroline: true }
        };
        layout.margin = {l: 0, r: 0, b: 0, t: 50};
    } else {
        layout.hovermode = 'closest';
        layout.xaxis = { 
            title: `PC${xIdx+1} (${varX}%)<br><span style="font-size:0.85em; color:gray">主な寄与: ${topX}</span>`, 
            zeroline: true 
        };
        layout.yaxis = { 
            title: `PC${yIdx+1} (${varY}%)<br><span style="font-size:0.85em; color:gray">主な寄与: ${topY}</span>`, 
            zeroline: true 
        };
        layout.annotations = annotations;
    }
    
    Plotly.newPlot('plot-container', traces, layout, {responsive: true, displaylogo: false});
    
    if (is3D) {
        updateSummary(xIdx, yIdx, parseFloat(varX), parseFloat(varY), topX, topY, zIdx, parseFloat(varZ), topZ);
    } else {
        updateSummary(xIdx, yIdx, parseFloat(varX), parseFloat(varY), topX, topY);
    }
}

function updateSummary(xIdx, yIdx, varX, varY, topX, topY, zIdx, varZ, topZ) {
    const summaryText = document.getElementById('summary-text');
    if(!summaryText) return;
    
    let transformText = "";
    if (transformMode === 'std') {
        transformText = "<span style='color: var(--primary); font-weight: 600;'>※ Z得点による標準化データを使用</span>";
    } else if (transformMode === 'log') {
        transformText = "<span style='color: var(--primary); font-weight: 600;'>※ 対数変換＋標準化データを使用</span>";
    } else if (transformMode === 'robust') {
        transformText = "<span style='color: var(--primary); font-weight: 600;'>※ ロバスト標準化データを使用</span>";
    } else {
        transformText = "<span style='color: var(--text-muted); font-weight: 600;'>※ 標準化なし（生データ）を使用</span>";
    }

    let missingText = "";
    if (missingMode === 'drop') {
        missingText = " <span style='color: var(--text-muted); font-size: 0.9em;'>(欠測行: 除外)</span>";
    } else if (missingMode === 'mean') {
        missingText = " <span style='color: #0369a1; font-size: 0.9em;'>(欠測: 平均値補完)</span>";
    } else if (missingMode === 'median') {
        missingText = " <span style='color: #0369a1; font-size: 0.9em;'>(欠測: 中央値補完)</span>";
    }
        
    let pcaInsightText = "";
    let clusterInsightText = "";
    
    if (pcaResult) {
        const ev = pcaResult.eigenValues;
        const totalVar = ev.reduce((a, b) => a + b, 0);
        let cum = 0;
        const cumRatios = ev.map(v => { cum += (v / totalVar) * 100; return cum; });
        
        const avgEigen = totalVar / ev.length;
        const kaiserCount = ev.filter(v => v >= avgEigen).length || 1;
        const kaiserCum = cumRatios[kaiserCount - 1].toFixed(1);
        pcaInsightText = `<p style="margin-top: 0.75rem; background: #eff6ff; padding: 0.6rem 0.8rem; border-radius: 6px; border-left: 3px solid #3b82f6; font-size: 0.9em;">
            <strong>【次元数の判定 (平均固有値基準 / カイザー基準)】</strong><br>
            第1〜第${kaiserCount}主成分までで、全体の分散の <strong>${kaiserCum}%</strong> を説明できています（情報量の維持率）。<br>
            ※目安として、固有値が平均(${avgEigen.toFixed(2)})以上となる主成分を採用することが推奨されます。
        </p>`;
        
        const spaceDesc = clusterSpace === 'pc' 
            ? "🎯 <strong>表示中主成分空間 (2D/3D平面)</strong> に基づきクラスタリングを実行中（平面上で領域が重なりにくく綺麗に分割されます）。"
            : "🌐 <strong>全変数の多次元空間</strong> に基づきクラスタリングを実行中（多次元の総合的類似度を忠実に反映。2D平面への射影のため楕円に重なりが生じる場合があります）。";

        if (clusterMethod === 'dbscan') {
            const stats = pcaResult.dbscanStats || { numClusters: 0, numNoise: 0 };
            clusterInsightText = `<p style="margin-top: 0.5rem; background: #faf5ff; padding: 0.6rem 0.8rem; border-radius: 6px; border-left: 3px solid #8b5cf6; font-size: 0.9em;">
                <strong>🌐 DBSCAN (密度クラスタリング分析):</strong><br>
                探索半径 eps = <strong>${dbscanEps.toFixed(2)}</strong>、最小点数 MinPts = <strong>${dbscanMinPts}</strong> により、
                <strong>${stats.numClusters} 個のクラスタ</strong> と <strong>${stats.numNoise} 件の外れ値（ノイズ）</strong> を検出しました。<br>
                <span style="font-size:0.85em; color:#6b21a8; display:block; margin-top:0.25rem;">${spaceDesc}</span>
            </p>`;
        } else {
            const optK = pcaResult.optimalK || 1;
            clusterInsightText = `<p style="margin-top: 0.5rem; background: #faf5ff; padding: 0.6rem 0.8rem; border-radius: 6px; border-left: 3px solid #8b5cf6; font-size: 0.9em;">
                <strong>🎯 K-Means クラスタリング分析:</strong><br>
                エルボー法（クラスタ内分散和 WCSS の変化率が最大となる屈曲点）に基づき、推奨クラスタ数 <strong>K = ${optK}</strong>。<br>
                <span style="font-size:0.85em; color:#6b21a8; display:block; margin-top:0.25rem;">${spaceDesc}</span>
            </p>`;
        }
    }

    const is3D = document.getElementById('enable-3d') ? document.getElementById('enable-3d').checked : false;
    let combinedVar = (parseFloat(varX) + parseFloat(varY));
    if (is3D) combinedVar += parseFloat(varZ);

    summaryText.innerHTML = `
        <p style="margin-bottom: 0.75rem; font-size: 0.9em;">${transformText}${missingText}</p>
        <p><strong>第${xIdx+1}主成分 (横軸)</strong> は、全体のデータの <strong>${varX}%</strong> の情報を説明しています。<br>
        この軸は主に <strong>「${topX}」</strong> の影響を強く受けています。</p>
        <p style="margin-top: 0.5rem;"><strong>第${yIdx+1}主成分 (縦軸)</strong> は、全体の <strong>${varY}%</strong> の情報を説明しています。<br>
        この軸は主に <strong>「${topY}」</strong> の影響を強く受けています。</p>
        ${is3D ? `<p style="margin-top: 0.5rem;"><strong>第${zIdx+1}主成分 (Z軸)</strong> は、全体の <strong>${varZ}%</strong> の情報を説明しています。<br>この軸は主に <strong>「${topZ}」</strong> の影響を強く受けています。</p>` : ''}
        <p style="margin-top: 0.5rem;">選択した軸を合わせることで、全体の <strong>${combinedVar.toFixed(1)}%</strong> の情報を一枚の図で表現できています。</p>
        ${pcaInsightText}
        ${clusterInsightText}
        <p style="margin-top: 1rem;"><small style="color: var(--text-muted);">※ グラフ軸の数値は各サンプルの「主成分得点」です。赤い矢印（ベクトル）の先端にマウスを重ねると、その変数の正確な相関係数（因子負荷量: -1.00〜+1.00）が表示されます。</small></p>
    `;
}

function getTopContributors(loadings) {
    const activeFeatures = getActiveFeatures();
    const arr = [];
    for (let i = 0; i < activeFeatures.length; i++) {
        arr.push({feature: activeFeatures[i], weight: Math.abs(loadings[i]), val: loadings[i]});
    }
    arr.sort((a, b) => b.weight - a.weight);
    
    const top = arr.slice(0, 2).map(item => {
        const dir = item.val > 0 ? '(+)' : '(-)';
        return `${item.feature} ${dir}`;
    });
    return top.join('、');
}

function downloadCsv() {
    if (!pcaResult) return;
    
    let csvContent = "";
    const numPCs = pcaResult.eigenValues.length;
    
    // 1. 主成分サマリー（固有値、個別寄与率、累積寄与率）
    csvContent += "主成分サマリー,";
    for (let i = 0; i < numPCs; i++) {
        csvContent += `PC${i+1},`;
    }
    csvContent += "\n";
    
    csvContent += "固有値 (Eigenvalue),";
    for (let i = 0; i < numPCs; i++) {
        csvContent += `${pcaResult.eigenValues[i].toFixed(4)},`;
    }
    csvContent += "\n";
    
    csvContent += "寄与率 (%),";
    for (let i = 0; i < numPCs; i++) {
        csvContent += `${(pcaResult.explainedVar[i] * 100).toFixed(2)}%,`;
    }
    csvContent += "\n";
    
    csvContent += "累積寄与率 (%),";
    let cumVar = 0;
    for (let i = 0; i < numPCs; i++) {
        cumVar += pcaResult.explainedVar[i] * 100;
        csvContent += `${cumVar.toFixed(2)}%,`;
    }
    csvContent += "\n\n";
    
    // 2. サンプル主成分得点 (Scores)
    csvContent += "サンプル名,所属クラスタ,";
    for (let i = 0; i < numPCs; i++) {
        csvContent += `PC${i+1},`;
    }
    csvContent += "\n";
    
    for (let i = 0; i < pcaResult.labels.length; i++) {
        const clVal = pcaResult.clusters[i];
        const clName = (clVal === -1) ? "外れ値 (ノイズ)" : `クラスタ ${clVal + 1}`;
        csvContent += `"${pcaResult.labels[i]}",${clName},`;
        for (let j = 0; j < pcaResult.scores[i].length; j++) {
            csvContent += `${pcaResult.scores[i][j].toFixed(4)},`;
        }
        csvContent += "\n";
    }
    
    // 3. 因子負荷量 (Factor Loadings)
    csvContent += "\n分析変数 (因子負荷量 / 相関係数),";
    for (let i = 0; i < numPCs; i++) {
        csvContent += `PC${i+1},`;
    }
    csvContent += "\n";
    
    const activeFeatures = getActiveFeatures();
    for (let i = 0; i < activeFeatures.length; i++) {
        csvContent += `"${activeFeatures[i]}",`;
        for (let j = 0; j < pcaResult.loadings[i].length; j++) {
            csvContent += `${pcaResult.loadings[i][j].toFixed(4)},`;
        }
        csvContent += "\n";
    }
    
    // 4. 主成分得点係数 / 固有ベクトル (Eigenvectors)
    if (pcaResult.eigenVectors) {
        csvContent += "\n分析変数 (主成分得点係数 / 固有ベクトル),";
        for (let i = 0; i < numPCs; i++) {
            csvContent += `PC${i+1},`;
        }
        csvContent += "\n";
        for (let i = 0; i < activeFeatures.length; i++) {
            csvContent += `"${activeFeatures[i]}",`;
            for (let j = 0; j < numPCs; j++) {
                csvContent += `${pcaResult.eigenVectors[i][j].toFixed(4)},`;
            }
            csvContent += "\n";
        }
    }
    
    // UTF-8 BOM を付与して Excel での文字化けを防止
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "pca_results.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function getEllipsePoints(xArray, yArray, numPoints = 100, confidence = 2.0) {
    const n = xArray.length;
    if (n < 1) return null;

    let mx = 0, my = 0;
    for(let i=0; i<n; i++) { mx += xArray[i]; my += yArray[i]; }
    mx /= n; my /= n;

    if (n === 1) {
        const r = 0.4;
        const pointsX = [], pointsY = [];
        for(let i=0; i<=numPoints; i++) {
            const t = (i / numPoints) * 2 * Math.PI;
            pointsX.push(mx + r * Math.cos(t));
            pointsY.push(my + r * Math.sin(t));
        }
        return {x: pointsX, y: pointsY};
    }

    if (n === 2) {
        const dx = xArray[1] - xArray[0];
        const dy = yArray[1] - yArray[0];
        const dist = Math.sqrt(dx*dx + dy*dy);
        const rX = Math.max(dist * 0.7, 0.4);
        const rY = Math.max(dist * 0.4, 0.3);
        const angle = Math.atan2(dy, dx);

        const pointsX = [], pointsY = [];
        for(let i=0; i<=numPoints; i++) {
            const t = (i / numPoints) * 2 * Math.PI;
            const x = rX * Math.cos(t);
            const y = rY * Math.sin(t);
            pointsX.push(mx + x * Math.cos(angle) - y * Math.sin(angle));
            pointsY.push(my + x * Math.sin(angle) + y * Math.cos(angle));
        }
        return {x: pointsX, y: pointsY};
    }

    let cxx = 0, cyy = 0, cxy = 0;
    for(let i=0; i<n; i++) {
        cxx += (xArray[i]-mx)*(xArray[i]-mx);
        cyy += (yArray[i]-my)*(yArray[i]-my);
        cxy += (xArray[i]-mx)*(yArray[i]-my);
    }
    cxx /= (n-1); cyy /= (n-1); cxy /= (n-1);

    const trace = cxx + cyy;
    const det = cxx * cyy - cxy * cxy;
    const inner = Math.max(0, trace*trace - 4*det);
    const lambda1 = (trace + Math.sqrt(inner)) / 2;
    const lambda2 = (trace - Math.sqrt(inner)) / 2;

    let v1x, v1y;
    if (Math.abs(cxy) < 1e-8) {
        // cxy がほぼ0のとき: 分散が大きい方の軸を主軸とする
        if (cxx >= cyy) {
            v1x = 1; v1y = 0;
        } else {
            v1x = 0; v1y = 1;
        }
    } else {
        v1x = cxy;
        v1y = lambda1 - cxx;
    }
    const norm = Math.sqrt(v1x*v1x + v1y*v1y) || 1;
    v1x /= norm; v1y /= norm;

    const angle = Math.atan2(v1y, v1x);
    const a = Math.sqrt(Math.max(0, lambda1)) * confidence;
    const b = Math.sqrt(Math.max(0, lambda2)) * confidence;

    const pointsX = [];
    const pointsY = [];
    for(let i=0; i<=numPoints; i++) {
        const t = (i / numPoints) * 2 * Math.PI;
        const x = a * Math.cos(t);
        const y = b * Math.sin(t);
        
        pointsX.push(mx + x * Math.cos(angle) - y * Math.sin(angle));
        pointsY.push(my + x * Math.sin(angle) + y * Math.cos(angle));
    }
    return {x: pointsX, y: pointsY};
}

function renderDataDiagnosis() {
    const diagCard = document.getElementById('diagnosis-card');
    if (!diagCard) return;
    
    const activeFeatures = getActiveFeatures();
    const activeData = getActiveNumericData();
    
    if (activeFeatures.length < 2) {
        diagCard.innerHTML = `
            <div style="font-weight: bold; color: #dc2626;">⚠️ 分析対象の変数が足りません</div>
            <div style="font-size: 0.9em; color: var(--text-muted); margin-top: 0.25rem;">基本統計量テーブルのチェックボックスで、少なくとも2つ以上の変数を選択してください。</div>
        `;
        return;
    }
    
    const p = activeFeatures.length;
    const pairs = [];
    let sumAbsCorr = 0;
    let count = 0;
    
    for (let i = 0; i < p; i++) {
        const x = activeData.map(r => r[i]);
        for (let j = i + 1; j < p; j++) {
            const y = activeData.map(r => r[j]);
            const corrInfo = calculateCorrelationWithPValue(x, y);
            const corr = corrInfo.r;
            const absCorr = Math.abs(corr);
            pairs.push({ f1: activeFeatures[i], f2: activeFeatures[j], corr, absCorr });
            sumAbsCorr += absCorr;
            count++;
        }
    }
    
    pairs.sort((a, b) => b.absCorr - a.absCorr);
    const avgAbsCorr = count > 0 ? sumAbsCorr / count : 0;
    const topPair = pairs[0];
    
    let title = "";
    let desc = "";
    let badgeBg = "";
    let badgeColor = "";
    
    if (avgAbsCorr >= 0.35 || (topPair && topPair.absCorr >= 0.6)) {
        title = "【強い相互関係あり】 主成分分析 (PCA) に非常に適したデータです";
        desc = "変数同士にまとまった相関関係が見られます。主成分分析を行うことで、多数の指標を少数の「総合指標」に効率よく要約（次元削減）できます。";
        badgeBg = "#dcfce7";
        badgeColor = "#15803d";
    } else if (avgAbsCorr >= 0.2 || (topPair && topPair.absCorr >= 0.35)) {
        title = "【中程度の相互関係あり】 主成分分析 (PCA) が有効です";
        desc = "一部の変数間に相関の傾向が見られます。主成分分析により主要な特徴パターンを要約することが可能です。";
        badgeBg = "#e0f2fe";
        badgeColor = "#0369a1";
    } else {
        title = "【相互にほぼ独立】 各変数は独自の情報を持っています";
        desc = "変数同士の相関が全体的に弱いため、主成分分析を行っても情報を1〜2個の軸に大きく集約する効果はやや限定的となる可能性があります。";
        badgeBg = "#fef3c7";
        badgeColor = "#b45309";
    }
    
    let topPairsHTML = "";
    if (pairs.length > 0) {
        const showPairs = pairs.slice(0, 3);
        topPairsHTML = `<div style="margin-top: 0.75rem; font-size: 0.88em; border-top: 1px dashed var(--border); padding-top: 0.5rem;">
            <strong>📌 特に関連の強い組み合わせ（上位）:</strong>
            <ul style="margin: 0.25rem 0 0 1.25rem; padding: 0;">
                ${showPairs.map(p => {
                    const dirStr = p.corr > 0 ? '正の相関（同じ方向に連動）' : '負の相関（逆方向に連動）';
                    return `<li><strong>${p.f1}</strong> ↔ <strong>${p.f2}</strong> : 相関係数 ${p.corr > 0 ? '+' : ''}${p.corr.toFixed(2)} (${dirStr})</li>`;
                }).join('')}
            </ul>
        </div>`;
    }
    
    const nSamples = activeData.length;
    let dimensionWarningHTML = "";
    if (nSamples <= p) {
        dimensionWarningHTML = `
            <div style="margin-top: 0.75rem; background: #fffbeb; border: 1px solid #fde68a; padding: 0.6rem 0.85rem; border-radius: 6px; font-size: 0.88em; color: #92400e; line-height: 1.45;">
                ⚠️ <strong>高次元・小標本データに関する注意 (サンプル数 ${nSamples} ≦ 変数数 ${p}):</strong><br>
                データ行数（サンプル数）が変数数以下であるため、数学的に非ゼロの有効固有値は最大 ${Math.max(1, nSamples - 1)} 個に縮退します。主成分の一般化には追加サンプルの収集を推奨します。
            </div>
        `;
    }
    
    diagCard.style.borderLeftColor = badgeColor;
    diagCard.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; flex-wrap: wrap; gap: 0.5rem;">
            <div style="font-weight: bold; font-size: 1.05em; color: var(--text-color);">💡 データ関係性の自動診断結果</div>
            <span style="background-color: ${badgeBg}; color: ${badgeColor}; padding: 0.25rem 0.75rem; border-radius: 9999px; font-weight: 600; font-size: 0.85em;">
                ${title.split(' ')[0]}
            </span>
        </div>
        <div style="font-weight: 600; color: ${badgeColor}; margin-bottom: 0.25rem;">${title}</div>
        <div style="font-size: 0.9em; color: var(--text-color); line-height: 1.5;">${desc}</div>
        ${dimensionWarningHTML}
        ${topPairsHTML}
    `;
}

function renderScreePlot() {
    const container = document.getElementById('scree-container');
    const toggle = document.getElementById('show-scree-plot');
    if (!container || !toggle) return;
    
    if (!toggle.checked || !pcaResult) {
        container.classList.add('hidden');
        return;
    }
    container.classList.remove('hidden');
    
    const eigenValues = pcaResult.eigenValues;
    const totalVar = eigenValues.reduce((a, b) => a + b, 0);
    const varRatios = eigenValues.map(v => (v / totalVar) * 100);
    
    let cum = 0;
    const cumRatios = varRatios.map(v => {
        cum += v;
        return cum;
    });
    
    const xLabels = eigenValues.map((_, i) => `PC${i+1}`);
    
    const avgEigen = totalVar / eigenValues.length;
    const kaiserCount = eigenValues.filter(v => v >= avgEigen).length || 1;
    let cum80Count = cumRatios.findIndex(c => c >= 80) + 1;
    if (cum80Count === 0) cum80Count = eigenValues.length;
    
    // 固有値 (右肩下がりの主成分固有値プロット: 教科書の標準スタイル)
    const traceEigen = {
        x: xLabels,
        y: eigenValues,
        name: '固有値 (Eigenvalue)',
        type: 'scatter',
        mode: 'lines+markers',
        line: { color: '#1d4ed8', width: 3 },
        marker: { color: '#1d4ed8', size: 8 },
        yaxis: 'y',
        customdata: varRatios,
        hovertemplate: '<b>%{x}</b><br>固有値: %{y:.3f}<br>寄与率: %{customdata:.2f}%<extra></extra>'
    };
    
    // 個別寄与率 (%) (背景の棒グラフ)
    const traceBar = {
        x: xLabels,
        y: varRatios,
        name: '個別寄与率 (%)',
        type: 'bar',
        marker: { color: 'rgba(59, 130, 246, 0.35)' },
        yaxis: 'y2',
        hovertemplate: '<b>%{x}</b><br>個別寄与率: %{y:.2f}%<extra></extra>'
    };
    
    // 累積寄与率 (%) (右肩上がりの点線)
    const traceCum = {
        x: xLabels,
        y: cumRatios,
        name: '累積寄与率 (%)',
        type: 'scatter',
        mode: 'lines+markers',
        line: { color: '#dc2626', width: 2, dash: 'dot' },
        marker: { color: '#dc2626', size: 6 },
        yaxis: 'y2',
        hovertemplate: '<b>%{x}</b><br>累積寄与率: %{y:.2f}%<extra></extra>'
    };

    // カイザー基準線 (平均固有値)
    const traceKaiser = {
        x: [xLabels[0], xLabels[xLabels.length - 1]],
        y: [avgEigen, avgEigen],
        name: `平均固有値基準線 (${avgEigen.toFixed(2)})`,
        type: 'scatter',
        mode: 'lines',
        line: { color: '#d97706', width: 1.5, dash: 'dash' },
        hoverinfo: 'none',
        yaxis: 'y'
    };

    // 累積寄与率 80% 目標線
    const traceCum80 = {
        x: [xLabels[0], xLabels[xLabels.length - 1]],
        y: [80, 80],
        name: '累積寄与率 80%目標線',
        type: 'scatter',
        mode: 'lines',
        line: { color: '#10b981', width: 1.5, dash: 'dot' },
        hoverinfo: 'none',
        yaxis: 'y2'
    };
    
    const maxEigen = Math.max(...eigenValues);
    const layout = {
        title: { text: '主成分のスクリープロット (次元・主成分数決定の判定根拠)', font: { size: 15 } },
        height: 450,
        xaxis: { title: '主成分' },
        yaxis: {
            title: '固有値 (Eigenvalue)',
            range: [0, Math.max(maxEigen * 1.15, 1.25)],
            zeroline: true
        },
        yaxis2: {
            title: '寄与率 / 累積寄与率 (%)',
            overlaying: 'y',
            side: 'right',
            range: [0, 105],
            showgrid: false
        },
        margin: { l: 60, r: 60, t: 60, b: 80 },
        showlegend: true,
        legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.25 },
        annotations: [
            {
                x: xLabels[Math.min(kaiserCount - 1, xLabels.length - 1)],
                y: eigenValues[Math.min(kaiserCount - 1, eigenValues.length - 1)],
                xref: 'x',
                yref: 'y',
                text: `💡 平均固有値基準適合: PC1〜PC${kaiserCount}<br>(固有値 ≥ ${avgEigen.toFixed(2)} 達成)`,
                showarrow: true,
                arrowhead: 2,
                ax: 40,
                ay: -35,
                bgcolor: 'rgba(239, 246, 255, 0.95)',
                bordercolor: '#2563eb',
                borderwidth: 1,
                font: { size: 11, color: '#1e40af' }
            }
        ]
    };
    
    Plotly.newPlot('scree-container', [traceBar, traceEigen, traceCum, traceKaiser, traceCum80], layout, {responsive: true, displaylogo: false});
}

function renderElbowPlot() {
    const container = document.getElementById('elbow-container');
    const toggle = document.getElementById('show-elbow-plot');
    if (!container || !toggle) return;
    
    if (!toggle.checked || !pcaResult || !pcaResult.wcss) {
        container.classList.add('hidden');
        return;
    }
    container.classList.remove('hidden');
    
    const wcss = pcaResult.wcss;
    const optimalK = pcaResult.optimalK || 1;
    const kLabels = wcss.map((_, i) => `K=${i+1}`);
    
    const traceWcss = {
        x: kLabels,
        y: wcss,
        name: 'クラスタ内分散和 (WCSS)',
        type: 'scatter',
        mode: 'lines+markers',
        line: { color: '#8b5cf6', width: 3 },
        marker: { color: '#8b5cf6', size: 8 },
        hovertemplate: '<b>%{x}</b><br>WCSS: %{y:.2f}<extra></extra>'
    };
    
    const optIdx = Math.min(optimalK - 1, wcss.length - 1);
    const traceOpt = {
        x: [kLabels[optIdx]],
        y: [wcss[optIdx]],
        name: `最適クラスタ数 (K=${optimalK})`,
        type: 'scatter',
        mode: 'markers',
        marker: { color: '#f59e0b', size: 16, symbol: 'star' },
        hovertemplate: `<b>★ 最適クラスタ数 K=${optimalK}</b><br>エルボー判定点<extra></extra>`
    };
    
    const layout = {
        title: { text: `クラスタ数決定プロット (エルボー法 / WCSS分析) - 最適 K = ${optimalK}`, font: { size: 15 } },
        height: 430,
        xaxis: { title: 'クラスタ数 (K)' },
        yaxis: { title: 'クラスタ内分散和 (WCSS)', zeroline: false },
        margin: { l: 60, r: 60, t: 60, b: 80 },
        showlegend: true,
        legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.25 },
        annotations: [
            {
                x: kLabels[optIdx],
                y: wcss[optIdx],
                xref: 'x',
                yref: 'y',
                text: `🎯 最適クラスタ数 K=${optimalK}<br>(歪みの減衰率が最大となるエルボー点)`,
                showarrow: true,
                arrowhead: 2,
                ax: 45,
                ay: -40,
                bgcolor: 'rgba(250, 245, 255, 0.95)',
                bordercolor: '#8b5cf6',
                borderwidth: 1,
                font: { size: 12, color: '#6b21a8' }
            }
        ]
    };
    
    Plotly.newPlot('elbow-container', [traceWcss, traceOpt], layout, {responsive: true, displaylogo: false});
}

function renderLoadingsChart() {
    const container = document.getElementById('loadings-container');
    const toggle = document.getElementById('show-loadings-chart');
    if (!container || !toggle) return;
    
    if (!toggle.checked || !pcaResult) {
        container.classList.add('hidden');
        return;
    }
    container.classList.remove('hidden');
    
    const activeFeatures = getActiveFeatures();
    const xIdx = parseInt(axisXSelect.value);
    const yIdx = parseInt(axisYSelect.value);
    
    const loadingsX = activeFeatures.map((_, i) => pcaResult.loadings[i][xIdx]);
    const loadingsY = activeFeatures.map((_, i) => pcaResult.loadings[i][yIdx]);
    
    const traceX = {
        x: activeFeatures,
        y: loadingsX,
        name: `PC${xIdx+1} 因子負荷量`,
        type: 'bar',
        marker: { color: '#2563eb' }
    };
    
    const traceY = {
        x: activeFeatures,
        y: loadingsY,
        name: `PC${yIdx+1} 因子負荷量`,
        type: 'bar',
        marker: { color: '#93c5fd' }
    };
    
    const layout = {
        title: { text: `因子負荷量 (変数ごとの影響度: PC${xIdx+1} vs PC${yIdx+1})`, font: { size: 14 } },
        height: 420,
        barmode: 'group',
        xaxis: { title: '変数' },
        yaxis: { title: '因子負荷量 (相関係数)', range: [-1.1, 1.1] },
        margin: { l: 60, r: 30, t: 60, b: 80 },
        showlegend: true,
        legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.25 }
    };
    
    Plotly.newPlot('loadings-container', [traceX, traceY], layout, {responsive: true, displaylogo: false});
}
