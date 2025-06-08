import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import type { GeoTiffData } from "../utils/geotiff";

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
                    "raster-opacity": 0.9,
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

export const addMapLayerFromDem = async (geotiffData: GeoTiffData) => {
    if (!mapLibreMap) {
        throw new Error("MapLibre map instance is not initialized.");
    }

    const { geoTransform, demArray, imageSize, statistics } = geotiffData;

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
    mapLibreMap.addLayer({
        id: "canvas-layer",
        type: "raster",
        source: "canvas-source",
    });

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
