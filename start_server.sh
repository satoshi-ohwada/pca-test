#!/usr/bin/env bash

# スクリプトの配置ディレクトリに移動
cd "$(dirname "$0")" || exit 1

DEFAULT_PORT=8000
PORT=${1:-$DEFAULT_PORT}

# 空きポート探索
check_port() {
    local p=$1
    if command -v ss >/dev/null 2>&1; then
        ss -tuln | grep -q ":$p "
    elif command -v lsof >/dev/null 2>&1; then
        lsof -i :"$p" >/dev/null 2>&1
    else
        return 1
    fi
}

while check_port "$PORT"; do
    echo "ポート $PORT は既に使用されています。次のポートを試します..."
    PORT=$((PORT + 1))
done

echo "========================================================"
echo " 🚀 簡易主成分分析（PCA）ツール ローカルテストサーバー"
echo "========================================================"
echo " 公開ディレクトリ : $(pwd)"
echo " ポート番号       : $PORT"
echo " アクセスURL      : http://localhost:$PORT"
echo " 停止方法         : [Ctrl + C] を押して終了"
echo "========================================================"
echo ""

# Python 3 で起動（優先）
if command -v python3 >/dev/null 2>&1; then
    exec python3 -m http.server "$PORT"
# Node.js で起動（フォールバック）
elif command -v node >/dev/null 2>&1; then
    exec node -e "
const http = require('http');
const fs = require('fs');
const path = require('path');

const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
    let filePath = path.join(process.cwd(), decodeURIComponent(req.url.split('?')[0]));
    if (filePath.endsWith(path.sep) || (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory())) {
        filePath = path.join(filePath, 'index.html');
    }

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
                res.end('404 Not Found');
            } else {
                res.writeHead(500);
                res.end('Server Error: ' + err.code);
            }
        } else {
            const ext = path.extname(filePath).toLowerCase();
            const contentType = mimeTypes[ext] || 'application/octet-stream';
            res.writeHead(200, {'Content-Type': contentType});
            res.end(content);
        }
    });
});

server.listen($PORT, () => {
    console.log('Node.js サーバーを起動しました: http://localhost:$PORT');
});
"
else
    echo "エラー: Python 3 または Node.js が見つかりません。" >&2
    exit 1
fi
