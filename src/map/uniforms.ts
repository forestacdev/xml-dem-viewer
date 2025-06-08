export interface Color {
    r: number;
    g: number;
    b: number;
}
export interface UniformValues {
    u_resolution: [number, number];
    u_bbox_4326: [number, number, number, number];
    u_min: number;
    u_max: number;
    u_max_color: Color;
    u_min_color: Color;
    u_dem_type: number;
    u_time: number;
    u_scale: number;
}

// グローバルなuniformsオブジェクト（外部から書き換え可能）
export const uniforms: UniformValues = {
    u_resolution: [1, 1],
    u_bbox_4326: [0, 0, 0, 0],
    u_min: 0,
    u_max: 100,
    u_max_color: { r: 1.0, g: 1.0, b: 1.0 },
    u_min_color: { r: 0.0, g: 0.0, b: 0.0 },
    u_dem_type: 0,
    u_time: 0,
    u_scale: 1.0,
};
