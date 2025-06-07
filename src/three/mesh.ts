import { uniforms } from "./threeCanvasWorker";

import fragmentShader from "./shaders/fragment.glsl?raw";
import vertexShader from "./shaders/vertex.glsl?raw";
import type { ImageSize, GeoTransform } from "../utils/geotiff";
import * as THREE from "three";

export const demMaterial = new THREE.ShaderMaterial({
    uniforms,
    // 頂点シェーダー
    vertexShader,
    fragmentShader,
    transparent: true,
});

export const generateDemMesh = (
    demArray: number[][],
    geoTransform: GeoTransform,
    imageSize: ImageSize,
): THREE.Mesh => {
    // DEMデータのサイズを取得
    const height = demArray.length;
    const width = demArray[0]?.length || 0;

    if (width === 0 || height === 0) {
        console.error("Invalid DEM data dimensions");
        return new THREE.Mesh(); // 空のメッシュを返す
    }

    // ピクセル解像度（スケール調整）
    const dx = imageSize.x / width;
    const dy = imageSize.y / height;
    // geoTransformのピクセルサイズを使ってelevationScaleを計算
    let elevationScale = 0.25; // デフォルト値

    if (geoTransform) {
        const pixelSizeX = Math.abs(geoTransform.pixelSizeX); // 度単位
        const pixelSizeY = Math.abs(geoTransform.pixelSizeY); // 度単位

        // 度をメートルに変換（緯度35度付近）
        const metersPerDegree = 111000; // 約111km/度
        const pixelSizeMetersX = pixelSizeX * metersPerDegree; // 約6.2m
        const pixelSizeMetersY = pixelSizeY * metersPerDegree; // 約6.2m

        // Three.js空間でのピクセルあたりの距離
        const meshPixelSizeX = dx; // Three.js空間でのX方向ピクセルサイズ
        const meshPixelSizeY = dy; // Three.js空間でのY方向ピクセルサイズ

        // 実距離とメッシュ距離の比率
        const scaleX = meshPixelSizeX / pixelSizeMetersX;
        const scaleY = meshPixelSizeY / pixelSizeMetersY;
        const averageScale = (scaleX + scaleY) / 2;

        // 標高も同じスケールを適用
        elevationScale = averageScale;

        console.log(
            `📏 実ピクセルサイズ: ${pixelSizeMetersX.toFixed(2)}m × ${pixelSizeMetersY.toFixed(2)}m`,
        );
        console.log(
            `📏 メッシュピクセルサイズ: ${meshPixelSizeX.toFixed(4)} × ${meshPixelSizeY.toFixed(4)}`,
        );
        console.log(`📏 スケール比率: ${averageScale.toFixed(6)}`);
        console.log(`📏 elevationScale: ${elevationScale.toFixed(6)}`);
    }

    // BufferGeometry作成
    const geometry = new THREE.BufferGeometry();

    // ラスターの中心座標を原点にするためのオフセット
    const xOffset = (width * dx) / 2;
    const zOffset = (height * dy) / 2;

    // 頂点座標の計算
    const vertices = new Float32Array(width * height * 3);
    for (let i = 0; i < height; i++) {
        for (let j = 0; j < width; j++) {
            const index = i * width + j;
            const x = j * dx - xOffset;
            const elevation = demArray[i][j] === -9999 ? 0 : demArray[i][j];
            const y = elevation * elevationScale;
            const z = i * dy - zOffset;
            const k = index * 3;
            vertices[k] = x;
            vertices[k + 1] = y;
            vertices[k + 2] = z;
        }
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));

    // UV座標の計算とセット（テクスチャマッピング用）
    const uvs = new Float32Array(width * height * 2);
    for (let i = 0; i < height; i++) {
        for (let j = 0; j < width; j++) {
            const index = i * width + j;
            const u = j / (width - 1);
            const v = i / (height - 1);
            const k = index * 2;
            uvs[k] = u;
            uvs[k + 1] = v;
        }
    }
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));

    // インデックス配列の作成（三角形を定義）
    const quadCount = (width - 1) * (height - 1);
    const indices = new Uint32Array(quadCount * 6);
    let p = 0;
    for (let i = 0; i < height - 1; i++) {
        for (let j = 0; j < width - 1; j++) {
            const a = i * width + j;
            const b = a + width;
            const c = a + 1;
            const d = b + 1;

            // 三角形1: a, b, c
            indices[p++] = a;
            indices[p++] = b;
            indices[p++] = c;

            // 三角形2: b, d, c
            indices[p++] = b;
            indices[p++] = d;
            indices[p++] = c;
        }
    }
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    // 法線ベクトルを計算（陰影効果のため）
    geometry.computeVertexNormals();

    // メッシュを作成
    const mesh = new THREE.Mesh(geometry, demMaterial);
    mesh.name = "demMesh";

    return mesh;
};
