import './style.css';

import { createDemFromZipUpload } from './demxml';

// ドラッグアンドドロップ機能の初期化
function initializeDragAndDrop() {
    const dropZone = document.getElementById('drop-zone');
    if (!dropZone) return;

    let dragCounter = 0;

    // ドラッグ開始時
    document.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        dropZone.style.display = 'flex';
    });

    // ドラッグ中
    document.addEventListener('dragover', (e) => {
        e.preventDefault();
    });

    // ドラッグ終了時
    document.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter === 0) {
            dropZone.style.display = 'none';
        }
    });

    // ドロップ時
    document.addEventListener('drop', async (e) => {
        e.preventDefault();
        dragCounter = 0;
        dropZone.style.display = 'none';

        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
            const file = files[0];
            if (file.type === 'application/zip' || file.name.endsWith('.zip')) {
                try {
                    const dem = await createDemFromZipUpload(file);
                    console.log('DEM created successfully:', dem);
                    // ここで成功時の処理を行う
                } catch (error) {
                    console.error('Error creating DEM:', error);
                    alert('ZIPファイルの処理中にエラーが発生しました');
                }
            } else {
                alert('ZIPファイルをドロップしてください');
            }
        }
    });
}

// DOMが読み込まれた後に初期化
document.addEventListener('DOMContentLoaded', () => {
    initializeDragAndDrop();
});

// ...existing code...
