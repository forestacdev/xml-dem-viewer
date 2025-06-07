// ダミーDOM要素を作成してイベントハンドリングを可能にする
export const createDummyDomElement = (width: number, height: number): HTMLElement => {
    const dummyDocument = {
        pointerLockElement: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        createElement: () => ({}),
        body: {},
        exitPointerLock: () => {},
    };

    const dummyElement = {
        // 基本的なプロパティ
        clientWidth: width,
        clientHeight: height,
        offsetWidth: width,
        offsetHeight: height,

        // DOM メソッド
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => {},
        appendChild: () => {},
        removeChild: () => {},

        // getBoundingClientRect
        getBoundingClientRect: () => ({
            left: 0,
            top: 0,
            width: width,
            height: height,
            right: width,
            bottom: height,
            x: 0,
            y: 0,
        }),

        // getRootNode
        getRootNode: () => dummyDocument,

        // ポインター関連のメソッド（重要！）
        setPointerCapture: () => {},
        releasePointerCapture: () => {},
        hasPointerCapture: () => false,
        requestPointerLock: () => {},

        // その他のプロパティ
        style: {
            cursor: '',
            touchAction: '',
            userSelect: '',
            webkitUserSelect: '',
            mozUserSelect: '',
            msUserSelect: '',
        },
        className: '',
        id: '',
        tagName: 'DIV',
        nodeName: 'DIV',
        nodeType: 1,

        // 親要素関連
        parentNode: null,
        parentElement: null,
        children: [],
        childNodes: [],

        // イベント関連
        onclick: null,
        onmousedown: null,
        onmousemove: null,
        onmouseup: null,
        onwheel: null,
        onpointerdown: null,
        onpointermove: null,
        onpointerup: null,
        onpointercancel: null,
        oncontextmenu: null,

        // ownerDocument
        ownerDocument: dummyDocument,

        // フォーカス関連
        focus: () => {},
        blur: () => {},

        // その他のメソッド
        querySelector: () => null,
        querySelectorAll: () => [],
        contains: () => false,

        // 属性関連
        getAttribute: () => null,
        setAttribute: () => {},
        removeAttribute: () => {},
        hasAttribute: () => false,

        // クラス関連
        classList: {
            add: () => {},
            remove: () => {},
            contains: () => false,
            toggle: () => false,
        },

        // データセット
        dataset: {},

        // スクロール関連
        scrollTop: 0,
        scrollLeft: 0,
        scrollWidth: width,
        scrollHeight: height,

        // クライアント関連
        clientTop: 0,
        clientLeft: 0,
    };

    return dummyElement as unknown as HTMLElement;
};
