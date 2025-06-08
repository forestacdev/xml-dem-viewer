import { uniforms } from "./worker.three-canvas.ts";

import fragmentShader from "./shaders/fragment.glsl?raw";
import vertexShader from "./shaders/vertex.glsl?raw";
import type { Statistics, GeoTransform } from "../utils/geotiff";
import * as THREE from "three";

export const demMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    glslVersion: THREE.GLSL3,
});

export const generateDemMesh = (
    demArray: number[][],
    geoTransform: GeoTransform,
    statistics: Statistics,
    meshScale: number = 10, // スケーリング係数を追加（デフォルト: 100）
): THREE.Mesh => {
    // DEMデータのサイズを取得
    const height = demArray.length;
    const width = demArray[0]?.length || 0;

    const bbox = [
        statistics.bounds.lower_left.lon, // minX (west)
        statistics.bounds.lower_left.lat, // minY (south)
        statistics.bounds.upper_right.lon, // maxX (east)
        statistics.bounds.upper_right.lat, // maxY (north)
    ] as [number, number, number, number];

    if (width === 0 || height === 0) {
        console.error("Invalid DEM data dimensions");
        return new THREE.Mesh(); // 空のメッシュを返す
    }

    // bboxから中心座標を計算
    const centerLon = (bbox[0] + bbox[2]) / 2; // (west + east) / 2
    const centerLat = (bbox[1] + bbox[3]) / 2; // (south + north) / 2
    const centerLatRad = (centerLat * Math.PI) / 180;

    // 地理座標系からメートル座標系への変換
    let pixelSizeMetersX: number;
    let pixelSizeMetersY: number;
    let elevationScale: number;

    if (geoTransform) {
        const pixelSizeX = Math.abs(geoTransform.pixelSizeX); // 度単位
        const pixelSizeY = Math.abs(geoTransform.pixelSizeY); // 度単位

        // 緯度による経度の実距離補正
        const metersPerDegreeLat = 111132.954; // 緯度1度の距離（メートル）
        const metersPerDegreeLon = 111132.954 * Math.cos(centerLatRad); // 経度1度の距離（緯度で補正）

        pixelSizeMetersX = pixelSizeX * metersPerDegreeLon;
        pixelSizeMetersY = pixelSizeY * metersPerDegreeLat;

        // 標高スケールもmeshScaleに合わせて調整
        elevationScale = 1 / meshScale; // 標高もスケール調整
    } else {
        // geoTransformがない場合のデフォルト値
        // bboxから推定されるピクセルサイズを計算
        const lonRange = bbox[2] - bbox[0]; // 経度範囲
        const latRange = bbox[3] - bbox[1]; // 緯度範囲

        const metersPerDegreeLat = 111132.954;
        const metersPerDegreeLon = 111132.954 * Math.cos(centerLatRad);

        pixelSizeMetersX = (lonRange * metersPerDegreeLon) / width;
        pixelSizeMetersY = (latRange * metersPerDegreeLat) / height;
        elevationScale = 1 / meshScale; // 標高もスケール調整（統一）
    }

    // Three.js空間でのピクセルサイズ（メートル単位をThree.js単位に変換）
    const dx = pixelSizeMetersX / meshScale;
    const dy = pixelSizeMetersY / meshScale;

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
