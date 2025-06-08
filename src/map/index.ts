import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { RasterLayerSpecification } from "maplibre-gl";

import { uniforms } from "./uniforms";

import type { GeoTiffData } from "../utils/geotiff";

import { Pane } from "tweakpane";

export interface CanvasOptions {
    array: Float32Array;
    bbox: [number, number, number, number];
    min: number;
    max: number;
    height: number;
    width: number;
}

// キャンバスとWebGLコンテキストの初期化
const canvas = document.createElement("canvas");
canvas.id = "canvas-layer";
canvas.style.display = "none"; // 非表示にする
document.body.appendChild(canvas);
const offscreenCanvas = canvas.transferControlToOffscreen();

// WebWorkerを使用してオフスクリーンレンダリングを行う
const canvasWorker = new Worker(new URL("./worker.canvas-layer.ts", import.meta.url), {
    type: "module",
});

canvasWorker.postMessage(
    {
        type: "init",
        canvas: offscreenCanvas,
    },
    [offscreenCanvas],
);

// 地図インスタンスの初期化
export const mapLibreMap = new maplibregl.Map({
    container: "map",
    style: {
        version: 8,
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: {
            pale: {
                type: "raster",
                tiles: ["https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png"],
                tileSize: 256,
                minzoom: 0,
                maxzoom: 18,
                attribution: "地理院タイル",
            },
        },
        layers: [
            {
                id: "pale",
                type: "raster",
                source: "pale",
                minzoom: 0,
                maxzoom: 22,
                paint: {
                    "raster-opacity": 0.7,
                    "raster-brightness-min": 1.0, // 画像の明るさ最小値
                    "raster-brightness-max": 0.0, // 画像の明るさ最大値
                    "raster-saturation": -1.0, // 画像の彩度
                    "raster-contrast": 0.0, // 画像のコントラスト
                },
            },
        ],
    },
    center: [139.477, 35.681],
    zoom: 4,
});

const canvasLayer: RasterLayerSpecification = {
    id: "canvas-layer",
    type: "raster",
    source: "canvas-source",
    paint: {
        "raster-opacity": 1.0, // 初期の不透明度
    },
};

export const addMapLayerFromDem = async (geotiffData: GeoTiffData) => {
    if (!mapLibreMap) {
        throw new Error("MapLibre map instance is not initialized.");
    }

    const { demArray, statistics } = geotiffData;

    const height = demArray.length;
    const width = demArray[0]?.length || 0;
    // 1次元配列に変換
    const elevationArray = new Float32Array(width * height);
    let index = 0;

    for (let i = 0; i < height; i++) {
        for (let j = 0; j < width; j++) {
            let elevation = demArray[i][j];
            // NoData値の処理

            elevationArray[index] = elevation;
            index++;
        }
    }

    const min = statistics.minElevation;
    const max = statistics.maxElevation;
    const bbox = [
        statistics.bounds.lower_left.lon, // minX (west)
        statistics.bounds.lower_left.lat, // minY (south)
        statistics.bounds.upper_right.lon, // maxX (east)
        statistics.bounds.upper_right.lat,
    ] as [number, number, number, number];

    const option: CanvasOptions = {
        array: elevationArray,
        bbox,
        min,
        max,
        height,
        width,
    };

    canvasWorker.postMessage({
        type: "add",
        option: option,
    });

    if (mapLibreMap.getSource("canvas-source")) {
        mapLibreMap.removeLayer("canvas-layer");
        // 既存のソースがある場合は削除
        mapLibreMap.removeSource("canvas-source");
    }
    // ソース追加
    mapLibreMap.addSource("canvas-source", {
        type: "canvas",
        canvas: canvas,
        coordinates: [
            [bbox[0], bbox[3]], // upper left
            [bbox[2], bbox[3]], // upper right
            [bbox[2], bbox[1]], // lower right
            [bbox[0], bbox[1]], // lower left
        ],
        animate: true,
    });
    // レイヤー追加
    mapLibreMap.addLayer(canvasLayer);

    mapLibreMap.fitBounds(bbox, {
        padding: { top: 50, bottom: 50, left: 50, right: 50 },
        duration: 0,
    });
};

export const toggleMapView = (isVisible: boolean) => {
    const mapContainer = document.getElementById("map");
    if (!mapContainer) {
        console.error("Map container not found.");
        return;
    }
    mapContainer.style.display = isVisible ? "block" : "none";
    if (isVisible && !mapLibreMap.isStyleLoaded()) {
        mapLibreMap.resize();
    }
};

const pane = new Pane({
    title: "パラメーター",
    container: document.getElementById("tweakpane-map") as HTMLElement,
});
pane.addBinding(canvasLayer.paint as any, "raster-opacity", {
    min: 0,
    max: 1,
    label: "不透明度",
    step: 0.01,
}).on("change", (ev) => {
    const mapLayer = mapLibreMap.getLayer(canvasLayer.id);
    if (mapLayer) {
        mapLibreMap.setPaintProperty(canvasLayer.id, "raster-opacity", ev.value);
    }
});
pane.addBinding(uniforms as any, "u_max", {
    min: 0,
    max: 4000,
    label: "最大",
    step: 0.01,
}).on("change", (ev) => {
    uniforms.u_max = ev.value;
    canvasWorker.postMessage({
        type: "updateUniforms",
        key: "u_max",
        value: ev.value,
    });
});

pane.addBinding(uniforms as any, "u_min", {
    min: 0,
    max: 4000,
    label: "最小",
    step: 0.01,
}).on("change", (ev) => {
    uniforms.u_min = ev.value;
    canvasWorker.postMessage({
        type: "updateUniforms",
        key: "u_min",
        value: ev.value,
    });
});

pane.addBinding(uniforms as any, "u_max_color", {
    label: "最大色",
    color: { type: "float" },
}).on("change", (ev) => {
    uniforms.u_max_color = ev.value;
    canvasWorker.postMessage({
        type: "updateUniforms",
        key: "u_max_color",
        value: ev.value,
    });
});

pane.addBinding(uniforms as any, "u_min_color", {
    label: "最小色",
    color: { type: "float" },
}).on("change", (ev) => {
    uniforms.u_min_color = ev.value;
    canvasWorker.postMessage({
        type: "updateUniforms",
        key: "u_min_color",
        value: ev.value,
    });
});

// TODO: uniformsの更新
canvasWorker.onmessage = (event) => {
    switch (event.data.type) {
        case "update":
            uniforms.u_min_color = event.data.uniforms.u_min_color;
            uniforms.u_max_color = event.data.uniforms.u_max_color;
            uniforms.u_min = event.data.uniforms.u_min;
            uniforms.u_max = event.data.uniforms.u_max;

            pane.refresh();
            break;
    }
};
