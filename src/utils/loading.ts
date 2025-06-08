export const loadingEnd = async (): Promise<void> => {
    return new Promise((resolve) => {
        // 読み込み完了後にローディング画面を非表示にする
        const loading = document.getElementById("loading") as HTMLElement;

        loading.style.display = "none"; // ローディング画面を非表示にする
        resolve(); // 完了を通知
    });
};

export const loadingStart = () => {
    const loading = document.getElementById("loading") as HTMLElement;
    loading.style.display = "flex";
};
