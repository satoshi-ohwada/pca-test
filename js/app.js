let numericData = [];
let rawNumericData = [];
let labels = [];
let features = null;
let disabledFeatures = new Set();
let disabledLabels = new Set();
let detectedOutlierLabels = new Set();
let transformMode = 'std'; // 'std', 'log', 'robust', 'none'
let corrMethod = 'pearson'; // 'pearson', 'spearman'
let pcaResult = null;
let currentScale = 1.0;

let currentRelView = 'heatmap';

function getActiveFeatures() {
    if (!features) return [];
    return features.filter(f => !disabledFeatures.has(f));
}

function getActiveLabels() {
    if (!labels) return [];
    return labels.filter(l => !disabledLabels.has(l));
}

function getActiveNumericData() {
    if (!numericData || numericData.length === 0) return [];
    const activeColIndices = [];
    features.forEach((f, idx) => {
        if (!disabledFeatures.has(f)) activeColIndices.push(idx);
    });
    
    const activeData = [];
    labels.forEach((label, rIdx) => {
        if (!disabledLabels.has(label)) {
            activeData.push(activeColIndices.map(cIdx => numericData[rIdx][cIdx]));
        }
    });
    return activeData;
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

if (btnUseSample) {
    btnUseSample.addEventListener('click', () => {
        const parseAndProcess = (csvText) => {
            Papa.parse(csvText, {
                complete: function(results) {
                    if (results.data && results.data.length >= 3) {
                        processRawData(results.data);
                    } else {
                        alert("サンプルデータのパースに失敗しました。データ形式を確認してください。");
                    }
                },
                error: function(err) {
                    alert("CSVパースエラー: " + err);
                },
                header: false,
                skipEmptyLines: true
            });
        };

        const csvInMemory = (typeof sampleCsv !== 'undefined' && sampleCsv) ? sampleCsv : (typeof window !== 'undefined' ? window.sampleCsv : null);
        if (csvInMemory && csvInMemory.length > 50) {
            parseAndProcess(csvInMemory);
            return;
        }

        fetch('js/sample_data.csv?v=' + Date.now())
            .then(res => {
                if (!res.ok) throw new Error("HTTP Status " + res.status);
                return res.text();
            })
            .then(text => {
                parseAndProcess(text);
            })
            .catch(err => {
                console.error("fetch sample error:", err);
                alert("サンプルデータの読み込み（fetch）に失敗しました: " + err.message + "\n※ 「1. データセット・インポート」エリアのファイル選択またはExcel貼り付け機能もお試しください。");
            });
    });
}

if (btnRunPca) btnRunPca.addEventListener('click', runPCA);
if (axisXSelect) axisXSelect.addEventListener('change', updatePlot);
if (axisYSelect) axisYSelect.addEventListener('change', updatePlot);
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
if (clusterCount) {
    const handleClusterChange = (e) => {
        const k = parseInt(e.target.value);
        const clusterValSpan = document.getElementById('cluster-value');
        if (clusterValSpan) clusterValSpan.textContent = k;
        if (pcaResult) {
            pcaResult.clusters = kMeansBest(pcaResult.X, k).clusters;
            updatePlot();
        }
    };
    clusterCount.addEventListener('input', handleClusterChange);
    clusterCount.addEventListener('change', handleClusterChange);
}

if (btnReset) {
    btnReset.addEventListener('click', () => {
        transformMode = 'std';
        corrMethod = 'pearson';
        disabledFeatures = new Set();
        disabledLabels = new Set();
        detectedOutlierLabels = new Set();
        
        const transformSelect = document.getElementById('transform-mode-select');
        const transformSelect2 = document.getElementById('transform-mode-select-step2');
        if (transformSelect) transformSelect.value = 'std';
        if (transformSelect2) transformSelect2.value = 'std';
        
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
        if (uploadSection) uploadSection.classList.remove('hidden');
        if (resultsSection) resultsSection.classList.add('hidden');
        if (dataPreview) dataPreview.classList.add('hidden');
        if (fileInput) fileInput.value = "";
    });
}

if (btnBackToData) {
    btnBackToData.addEventListener('click', () => {
        resultsSection.classList.add('hidden');
        uploadSection.classList.remove('hidden');
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
        if (detectedOutlierLabels.size === 0) {
            alert("現在、1.5×IQR基準を超える外れ値サンプルは検出されていません。");
            return;
        }
        detectedOutlierLabels.forEach(lbl => disabledLabels.add(lbl));
        refreshAllVisualizations();
    });
}

const btnResetSampleExclusion = document.getElementById('btn-reset-sample-exclusion');
if (btnResetSampleExclusion) {
    btnResetSampleExclusion.addEventListener('click', () => {
        disabledLabels.clear();
        refreshAllVisualizations();
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
        Papa.parse(text, {
            complete: function(results) {
                if (results.data && results.data.length >= 3) {
                    processRawData(results.data);
                } else {
                    alert("読み込めるデータ行が不足しています。表形式（ヘッダー＋2行以上）のデータをコピーしてください。");
                }
            },
            header: false,
            skipEmptyLines: true
        });
    });
}


// --- Functions ---

function handleFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    
    if (ext === 'csv') {
        Papa.parse(file, {
            complete: function(results) {
                processRawData(results.data);
            },
            header: false,
            skipEmptyLines: true
        });
    } else if (ext === 'xlsx' || ext === 'xls') {
        const reader = new FileReader();
        reader.onload = (e) => {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, {type: 'array'});
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(firstSheet, {header: 1});
            processRawData(jsonData);
        };
        reader.readAsArrayBuffer(file);
    } else {
        alert("未対応のファイル形式です。.csv または .xlsx を使用してください。");
    }
}

function processRawData(data) {
    try {
        if (!data || data.length < 3) {
            alert("データが少なすぎます。分析にはより多くの行が必要です。");
            return;
        }
        
        const headerRow = data[0];
        features = headerRow.slice(1);
        
        const rawLabels = [];
        const parsedNumeric = [];
        
        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            if (!row || row.length === 0 || !row[0]) continue;
            
            rawLabels.push(String(row[0]).trim() || `Row ${i}`);
            
            const numericRow = [];
            for (let j = 1; j < headerRow.length; j++) {
                const val = parseFloat(row[j]);
                numericRow.push(isNaN(val) ? 0 : val);
            }
            parsedNumeric.push(numericRow);
        }
        
        labels = rawLabels;
        rawNumericData = parsedNumeric;
        disabledFeatures = new Set();
        disabledLabels = new Set();
        detectedOutlierLabels = new Set();
        pcaResult = null;
        
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
    if (transformMode === 'none') return;
    
    if (transformMode === 'log') {
        for (let j = 0; j < p; j++) {
            let minVal = Infinity;
            for (let i = 0; i < n; i++) {
                if (numericData[i][j] < minVal) minVal = numericData[i][j];
            }
            const shift = minVal < 0 ? Math.abs(minVal) + 1 : 0;
            for (let i = 0; i < n; i++) {
                numericData[i][j] = Math.log(numericData[i][j] + shift + 1);
            }
        }
        for (let j = 0; j < p; j++) {
            let sum = 0;
            for (let i = 0; i < n; i++) sum += numericData[i][j];
            const mean = sum / n;
            let sumSq = 0;
            for (let i = 0; i < n; i++) sumSq += Math.pow(numericData[i][j] - mean, 2);
            const stdDev = Math.sqrt(sumSq / (n > 1 ? n - 1 : 1)) || 1;
            for (let i = 0; i < n; i++) {
                numericData[i][j] = (numericData[i][j] - mean) / stdDev;
            }
        }
    } else if (transformMode === 'robust') {
        for (let j = 0; j < p; j++) {
            const col = [];
            for (let i = 0; i < n; i++) col.push(numericData[i][j]);
            col.sort((a, b) => a - b);
            const mid = Math.floor(n / 2);
            const median = n % 2 !== 0 ? col[mid] : (col[mid - 1] + col[mid]) / 2;
            const q1 = col[Math.floor(n * 0.25)];
            const q3 = col[Math.floor(n * 0.75)];
            const iqr = (q3 - q1) || 1;
            for (let i = 0; i < n; i++) {
                numericData[i][j] = (numericData[i][j] - median) / iqr;
            }
        }
    } else {
        for (let j = 0; j < p; j++) {
            let sum = 0;
            for (let i = 0; i < n; i++) sum += numericData[i][j];
            const mean = sum / n;
            
            let sumSq = 0;
            for (let i = 0; i < n; i++) sumSq += Math.pow(numericData[i][j] - mean, 2);
            const stdDev = Math.sqrt(sumSq / (n > 1 ? n - 1 : 1)) || 1; 
            
            for (let i = 0; i < n; i++) {
                numericData[i][j] = (numericData[i][j] - mean) / stdDev;
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
    
    const activeNumeric = getActiveNumericData();
    const activeLabels = getActiveLabels();
    const activeFeatures = getActiveFeatures();
    
    if (!activeNumeric || activeNumeric.length === 0 || !features) return;
    
    const n = activeNumeric.length;
    const p = features.length;
    
    for (let j = 0; j < p; j++) {
        let min = Infinity, max = -Infinity, sum = 0;
        let colData = [];
        
        const colIdxInActive = activeFeatures.indexOf(features[j]);
        
        if (colIdxInActive !== -1) {
            for (let i = 0; i < n; i++) {
                const val = activeNumeric[i][colIdxInActive];
                colData.push(val);
                if (val < min) min = val;
                if (val > max) max = val;
                sum += val;
            }
        } else {
            labels.forEach((lbl, rIdx) => {
                if (!disabledLabels.has(lbl)) {
                    const val = numericData[rIdx][j];
                    colData.push(val);
                    if (val < min) min = val;
                    if (val > max) max = val;
                    sum += val;
                }
            });
        }
        
        colData.sort((a, b) => a - b);
        let median = 0;
        if (colData.length > 0) {
            const mid = Math.floor(colData.length / 2);
            median = colData.length % 2 !== 0 ? colData[mid] : (colData[mid - 1] + colData[mid]) / 2;
        }
        
        const mean = sum / (colData.length || 1);
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
            <td>${min.toFixed(2)}</td>
            <td>${max.toFixed(2)}</td>
            <td>${median.toFixed(2)}</td>
            <td>${mean.toFixed(2)}</td>
            <td>${stdDev.toFixed(2)}</td>
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
    renderPreview();
    renderStatistics();
    renderDataDiagnosis();
    if (!resultsSection.classList.contains('hidden')) {
        runPCA();
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
        const excludedCount = disabledLabels.size;
        badgeSpan.textContent = `全 ${total} サンプル中 ${activeCount} サンプル分析対象 (${excludedCount} 件除外中)`;
        badgeSpan.style.background = excludedCount > 0 ? '#fef3c7' : '#f1f5f9';
        badgeSpan.style.color = excludedCount > 0 ? '#92400e' : '#334155';
        badgeSpan.style.borderColor = excludedCount > 0 ? '#f59e0b' : '#cbd5e1';
    }

    const traces = [];
    const outlierSummary = [];
    detectedOutlierLabels = new Set();
    
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
                const lblName = activeLabels[rIdx];
                featOutlierLabels.push(lblName);
                detectedOutlierLabels.add(lblName);
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
            insightDiv.style.background = '#fef2f2';
            insightDiv.style.borderLeft = '4px solid #ef4444';
            insightDiv.style.color = '#991b1b';
            insightDiv.innerHTML = `⚠️ <strong>外れ値のアラート (1.5×IQR基準)</strong>: 以下の変数で極端な値（特定のサンプルなど）が検出されました。<br>${outlierSummary.join('<br>')}<br><span style="font-size:0.85em; color:#b91c1c; margin-top:0.25rem; display:block;">💡 上の「⚡ 検出された外れ値サンプルを一括除外」ボタンを押すことで、これらの特異なサンプルを分析からワンクリックで取り除くことができます。</span>`;
        } else {
            insightDiv.style.background = '#f0fdf4';
            insightDiv.style.borderLeft = '4px solid #22c55e';
            insightDiv.style.color = '#166534';
            insightDiv.innerHTML = `✅ <strong>分布チェック結果</strong>: 1.5×IQR基準を超える明らかな外れ値は検出されませんでした（良好な状態）。`;
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
    
    labels.forEach(lbl => {
        if (searchVal && !lbl.toLowerCase().includes(searchVal)) return;
        const isChecked = !disabledLabels.has(lbl);
        const isOutlier = detectedOutlierLabels.has(lbl);
        
        const labelEl = document.createElement('label');
        labelEl.style.cssText = 'display: flex; align-items: center; font-size: 0.82rem; cursor: pointer; user-select: none; gap: 0.3rem; margin: 0;';
        if (isOutlier) {
            labelEl.style.fontWeight = 'bold';
            labelEl.style.color = '#dc2626';
        }
        
        labelEl.innerHTML = `
            <input type="checkbox" class="sample-checkbox" data-label="${lbl}" ${isChecked ? 'checked' : ''} style="width: auto; margin-right: 0.2rem;">
            <span>${lbl}</span> ${isOutlier ? '<span title="外れ値として検出">⚠️</span>' : ''}
        `;
        container.appendChild(labelEl);
    });
    
    container.querySelectorAll('.sample-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const lbl = e.target.dataset.label;
            if (e.target.checked) {
                disabledLabels.delete(lbl);
            } else {
                if (getActiveLabels().length <= 3) {
                    alert("分析には最低3つのサンプル（データ行）が必要です。");
                    e.target.checked = true;
                    return;
                }
                disabledLabels.add(lbl);
            }
            refreshAllVisualizations();
        });
    });
}

function renderSPLOM() {
    const activeFeatures = getActiveFeatures();
    const activeData = getActiveNumericData();
    if (!activeFeatures || activeFeatures.length < 2 || !activeData || activeData.length === 0) return;
    
    const activeP = activeFeatures.length;
    const traces = [];
    const shapes = [];
    const layout = {
        showlegend: false,
        hovermode: 'closest',
        plot_bgcolor: '#f8fafc',
        paper_bgcolor: '#ffffff',
        margin: {l: 65, r: 25, b: 65, t: 75},
        height: Math.max(520, activeP * 150),
    };
    
    const gap = 0.02;
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
                tickfont: { size: 9, color: '#64748b' },
                range: [minX - padX, maxX + padX] 
            };
            layout[axNameY] = { 
                domain: [y0, y1], 
                showgrid: true,
                gridcolor: '#f1f5f9',
                zeroline: false, 
                showticklabels: c === 0, 
                nticks: 3,
                tickfont: { size: 9, color: '#64748b' },
                range: (r === c) ? undefined : [minY - padY, maxY + padY] 
            };
            
            if (r === c) {
                layout[axNameY].showticklabels = false;
            }
            
            if (r === 0) {
                layout[axNameX].side = 'top';
                layout[axNameX].showticklabels = false;
                layout[axNameX].title = { text: `<b>${activeFeatures[c]}</b>`, font: {size: 12, color: '#1e293b'}, standoff: 12 };
            }
            if (c === 0) {
                layout[axNameY].title = { text: `<b>${activeFeatures[r]}</b>`, font: {size: 12, color: '#1e293b'}, standoff: 12 };
            }
            
            const axisX = 'x' + (idx === 1 ? '' : idx);
            const axisY = 'y' + (idx === 1 ? '' : idx);
            
            if (r === c) {
                // Diagonal: Restored previous clean histogram + KDE line
                traces.push({
                    x: xData,
                    type: 'histogram',
                    histnorm: 'probability density',
                    marker: {color: '#93c5fd', line: {color: 'white', width: 1}},
                    xaxis: axisX,
                    yaxis: axisY,
                    hoverinfo: 'skip'
                });
                
                const kde = calculateKDE(xData);
                traces.push({
                    x: kde.x,
                    y: kde.y,
                    mode: 'lines',
                    type: 'scatter',
                    line: {color: '#1e3a8a', width: 2},
                    xaxis: axisX,
                    yaxis: axisY,
                    hoverinfo: 'skip'
                });
            } else {
                // Lower Triangle: Scatter plot + Linear Regression Trendline
                traces.push({
                    x: xData,
                    y: yData,
                    mode: 'markers',
                    type: 'scatter',
                    marker: { color: 'rgba(37, 99, 235, 0.65)', size: 5, line: {color: 'white', width: 0.5} },
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
                    line: { color: '#dc2626', width: 2 },
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
    const z = (1 - 1 / (4 * df)) * t / Math.sqrt(1 + t * t / (2 * df));
    const p = 2 * (1 - normalCDF(Math.abs(z)));
    
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
    let sum_x = 0, sum_y = 0, sum_xy = 0, sum_x2 = 0;
    for(let i=0; i<n; i++) {
        sum_x += x[i];
        sum_y += y[i];
        sum_xy += x[i]*y[i];
        sum_x2 += x[i]*x[i];
    }
    const m = (n*sum_xy - sum_x*sum_y) / (n*sum_x2 - sum_x*sum_x);
    const b = (sum_y - m*sum_x) / n;
    return {m, b};
}

function calculateKDE(data, steps=100) {
    const n = data.length;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min;
    const padding = range * 0.1;
    const xStart = min - padding;
    const xEnd = max + padding;
    const stepSize = (xEnd - xStart) / steps;
    
    let sum = 0;
    data.forEach(v => sum += v);
    const mean = sum/n;
    let sumSq = 0;
    data.forEach(v => sumSq += (v-mean)*(v-mean));
    const std = Math.sqrt(sumSq/n);
    const h = 1.06 * std * Math.pow(n, -0.2); 
    
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
    if(k <= 1 || data.length === 0) return {clusters: Array(data.length).fill(0)};
    let centroids = [];
    let indices = [];
    while(indices.length < k && indices.length < data.length) {
        let idx = Math.floor(Math.random() * data.length);
        if(!indices.includes(idx)) { indices.push(idx); centroids.push([...data[idx]]); }
    }
    let clusters = Array(data.length).fill(0);
    for(let iter = 0; iter < maxIter; iter++) {
        let changed = false;
        for(let i = 0; i < data.length; i++) {
            let minD = Infinity, bestC = 0;
            for(let c = 0; c < k; c++) {
                let d = 0;
                for(let j = 0; j < data[i].length; j++) {
                    d += Math.pow(data[i][j] - centroids[c][j], 2);
                }
                if(d < minD) { minD = d; bestC = c; }
            }
            if(clusters[i] !== bestC) { clusters[i] = bestC; changed = true; }
        }
        if(!changed) break;
        
        let sums = Array(k).fill(0).map(() => Array(data[0].length).fill(0));
        let counts = Array(k).fill(0);
        for(let i = 0; i < data.length; i++) {
            counts[clusters[i]]++;
            for(let j = 0; j < data[i].length; j++) sums[clusters[i]][j] += data[i][j];
        }
        for(let c = 0; c < k; c++) {
            if(counts[c] > 0) {
                for(let j = 0; j < sums[c].length; j++) centroids[c][j] = sums[c][j] / counts[c];
            }
        }
    }
    return {clusters};
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
    if(data.length < 4) return { optimalK: 1, wcss: [0] };
    let wcss = [];
    let maxK = Math.min(10, data.length - 1);
    for(let k = 1; k <= maxK; k++) {
        let best_w = Infinity;
        for(let r = 0; r < 3; r++) {
            let res = kMeans(data, k);
            let w = calculateWCSS(data, res.clusters, k);
            if(w < best_w) best_w = w;
        }
        wcss.push(best_w);
    }
    let bestK = 1;
    let maxDiff = -Infinity;
    if(wcss.length > 2) {
        for(let i = 1; i < wcss.length - 1; i++) {
            let d2 = (wcss[i-1] - wcss[i]) - (wcss[i] - wcss[i+1]);
            if(d2 > maxDiff) { maxDiff = d2; bestK = i+1; }
        }
    }
    const finalK = Math.max(1, Math.min(bestK, 5));
    return { optimalK: finalK, wcss: wcss };
}


function runPCA() {
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
        
        const n = X.length;
        const p = X[0].length;
        
        // --- 修正箇所: データの中心化 ---
        // (transformMode === 'none'の場合等、中心化されていないデータでも正しい共分散行列を計算するため)
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
        
        const eig = numeric.eig(cov);
        
        const ev = [];
        for (let i = 0; i < p; i++) {
            ev.push({
                val: eig.lambda.x[i],
                vec: eig.E.x.map(row => row[i])
            });
        }
        ev.sort((a, b) => b.val - a.val);
        
        const eigenValues = ev.map(x => x.val);
        const eigenVectors = numeric.transpose(ev.map(x => x.vec));
        
        const totalVar = eigenValues.reduce((a, b) => a + b, 0);
        const explainedVar = eigenValues.map(v => v / totalVar);
        
        const scores = numeric.dot(Xc, eigenVectors);
        
        const factorLoadings = [];
        for (let i = 0; i < p; i++) {
            factorLoadings[i] = [];
            for (let j = 0; j < p; j++) {
                factorLoadings[i][j] = eigenVectors[i][j] * Math.sqrt(Math.max(0, eigenValues[j]));
            }
        }
        
        const optKInfo = determineOptimalK(X);
        const optimalK = optKInfo.optimalK;
        clusterCount.value = optimalK;
        const clusterValSpan = document.getElementById('cluster-value');
        if (clusterValSpan) clusterValSpan.textContent = optimalK;

        const initialClusters = kMeansBest(X, optimalK).clusters;
        
        pcaResult = {
            X: X,
            labels: activeLabels,
            features: activeFeatures,
            scores: scores,
            loadings: factorLoadings,
            explainedVar: explainedVar,
            eigenValues: eigenValues,
            clusters: initialClusters,
            optimalK: optimalK,
            wcss: optKInfo.wcss
        };
        
        setupSelects(p);
        
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
    }
}

function updatePlot() {
    if (!pcaResult) return;
    
    const xIdx = parseInt(axisXSelect.value);
    const yIdx = parseInt(axisYSelect.value);
    
    const varX = (pcaResult.explainedVar[xIdx] * 100).toFixed(1);
    const varY = (pcaResult.explainedVar[yIdx] * 100).toFixed(1);
    
    const scoresX = pcaResult.scores.map(row => row[xIdx]);
    const scoresY = pcaResult.scores.map(row => row[yIdx]);
    
    const loadingsX = pcaResult.loadings.map(row => row[xIdx]);
    const loadingsY = pcaResult.loadings.map(row => row[yIdx]);
    
    const topX = getTopContributors(loadingsX);
    const topY = getTopContributors(loadingsY);
    
    const showLabels = document.getElementById('show-labels') ? document.getElementById('show-labels').checked : true;
    const showVectors = document.getElementById('show-vectors') ? document.getElementById('show-vectors').checked : true;
    const enableClustering = document.getElementById('enable-clustering') ? document.getElementById('enable-clustering').checked : true;
    const plotLabels = pcaResult.labels || getActiveLabels();
    
    const globalPositions = [];
    if (showLabels) {
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
    
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
    const numClusters = enableClustering ? (Math.max(...pcaResult.clusters) + 1) : 1;
    
    for(let c = 0; c < numClusters; c++) {
        const cX = [], cY = [], cText = [], cPos = [];
        for(let i=0; i<pcaResult.clusters.length; i++) {
            const ptCluster = enableClustering ? pcaResult.clusters[i] : 0;
            if(ptCluster === c) {
                cX.push(scoresX[i]);
                cY.push(scoresY[i]);
                cText.push(plotLabels[i]);
                if(showLabels) cPos.push(globalPositions[i]);
            }
        }
        if(cX.length > 0) {
            // Render ellipse background FIRST so markers and text sit cleanly on top
            const ellipse = enableClustering ? getEllipsePoints(cX, cY, 100, 2.0) : null;
            if (ellipse) {
                traces.push({
                    x: ellipse.x,
                    y: ellipse.y,
                    mode: 'lines',
                    type: 'scatter',
                    name: `クラスタ ${c+1} 領域`,
                    line: { color: colors[c % colors.length], width: 1.5 },
                    fill: 'toself',
                    fillcolor: colors[c % colors.length],
                    opacity: 0.12,
                    showlegend: false,
                    hoverinfo: 'skip'
                });
            }

            // Render markers and text labels SECOND (foreground)
            traces.push({
                x: cX,
                y: cY,
                mode: showLabels ? 'markers+text' : 'markers',
                type: 'scatter',
                name: enableClustering ? `クラスタ ${c+1}` : 'データ点',
                text: cText,
                textposition: showLabels ? cPos : undefined,
                marker: { 
                    size: 10, 
                    color: colors[c % colors.length], 
                    opacity: 0.95,
                    line: { color: '#ffffff', width: 1.5 }
                },
                textfont: { size: 11, color: '#1e293b' }
            });
        }
    }
    
    const maxX = Math.max(...scoresX.map(Math.abs));
    const maxY = Math.max(...scoresY.map(Math.abs));
    const maxScore = Math.max(maxX, maxY) || 1;
    
    const maxLoading = Math.max(...loadingsX.map(Math.abs), ...loadingsY.map(Math.abs)) || 1;
    const scalingFactor = (maxScore / maxLoading) * 0.8 * currentScale;
    
    const annotations = [];
    
    if (showVectors) {
        const activeFeatures = getActiveFeatures();
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

        // Sort by angle to detect overlapping directions
        vecData.sort((a, b) => a.angle - b.angle);

        // Assign stagger indices for close angles
        for (let k = 0; k < vecData.length; k++) {
            const current = vecData[k];
            let sameClusterIndex = 0;
            for (let j = k - 1; j >= 0; j--) {
                let diff = Math.abs(current.angle - vecData[j].angle);
                if (diff > Math.PI) diff = 2 * Math.PI - diff;
                if (diff < 0.25) { // approx 14 degrees
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
            
            // Arrow annotation
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

        // Hover trace for vectors
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
    
    const customTitle = plotTitleInput ? plotTitleInput.value : 'PCA バイプロット';
    
    const layout = {
        title: customTitle,
        hovermode: 'closest',
        xaxis: { 
            title: `PC${xIdx+1} (${varX}%)<br><span style="font-size:0.85em; color:gray">主な寄与: ${topX}</span>`, 
            zeroline: true 
        },
        yaxis: { 
            title: `PC${yIdx+1} (${varY}%)<br><span style="font-size:0.85em; color:gray">主な寄与: ${topY}</span>`, 
            zeroline: true 
        },
        margin: {l: 60, r: 50, b: 70, t: 50},
        annotations: annotations
    };
    
    Plotly.newPlot('plot-container', traces, layout, {responsive: true, displaylogo: false});
    
    updateSummary(xIdx, yIdx, parseFloat(varX), parseFloat(varY), topX, topY);
}

function updateSummary(xIdx, yIdx, varX, varY, topX, topY) {
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
            <strong>【次元数の判定 (平均固有値基準)】</strong><br>
            第1〜第${kaiserCount}主成分までで、全体の分散の <strong>${kaiserCum}%</strong> を説明できています（情報量の維持率）。<br>
            ※目安として、固有値が平均(${avgEigen.toFixed(2)})以上となる主成分を採用することが推奨されます。
        </p>`;
        
        const optK = pcaResult.optimalK || 1;
        clusterInsightText = `<p style="margin-top: 0.5rem; background: #faf5ff; padding: 0.6rem 0.8rem; border-radius: 6px; border-left: 3px solid #8b5cf6; font-size: 0.9em;">
            <strong>🎯 クラスタ数判定の根拠:</strong><br>
            エルボー法（クラスタ内分散和 WCSS の変化率が最大となる屈曲点）に基づき、最適分割数 <strong>K = ${optK}</strong> を自動決定。
        </p>`;
    }

    summaryText.innerHTML = `
        <p style="margin-bottom: 0.75rem; font-size: 0.9em;">${transformText}</p>
        <p><strong>第${xIdx+1}主成分 (横軸)</strong> は、全体のデータの <strong>${varX}%</strong> の情報を説明しています。<br>
        この軸は主に <strong>「${topX}」</strong> の影響を強く受けています。</p>
        <p style="margin-top: 0.5rem;"><strong>第${yIdx+1}主成分 (縦軸)</strong> は、全体の <strong>${varY}%</strong> の情報を説明しています。<br>
        この軸は主に <strong>「${topY}」</strong> の影響を強く受けています。</p>
        <p style="margin-top: 0.5rem;">2つの軸を合わせることで、全体の <strong>${(parseFloat(varX) + parseFloat(varY)).toFixed(1)}%</strong> の情報を一枚の図で表現できています。</p>
        ${pcaInsightText}
        ${clusterInsightText}
        <p style="margin-top: 1rem;"><small style="color: var(--text-muted);">※赤い矢印（ベクトル）が長いほど、その変数がその方向に強く影響していることを示します。</small></p>
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
    
    let csvContent = "Label,Cluster,";
    for (let i = 0; i < pcaResult.scores[0].length; i++) {
        csvContent += `PC${i+1},`;
    }
    csvContent += "\n";
    
    for (let i = 0; i < pcaResult.labels.length; i++) {
        csvContent += `${pcaResult.labels[i]},${pcaResult.clusters[i] + 1},`;
        for (let j = 0; j < pcaResult.scores[i].length; j++) {
            csvContent += `${pcaResult.scores[i][j]},`;
        }
        csvContent += "\n";
    }
    
    csvContent += "\nVariables (Loadings),";
    for (let i = 0; i < pcaResult.loadings[0].length; i++) {
        csvContent += `PC${i+1},`;
    }
    csvContent += "\n";
    
    const activeFeatures = getActiveFeatures();
    for (let i = 0; i < activeFeatures.length; i++) {
        csvContent += `${activeFeatures[i]},`;
        for (let j = 0; j < pcaResult.loadings[i].length; j++) {
            csvContent += `${pcaResult.loadings[i][j]},`;
        }
        csvContent += "\n";
    }
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
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

    let v1x = cxy, v1y = lambda1 - cxx;
    if (Math.abs(cxy) < 1e-8) {
        v1x = 1; v1y = 0;
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
