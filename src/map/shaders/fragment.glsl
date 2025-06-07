#version 300 es
precision highp float;

uniform sampler2D u_texArray;
uniform vec2 u_resolution;
uniform float u_dem_type; // 0: mapbox, 1: gsi, 2: terrarium
uniform float u_min;
uniform float u_max;

in vec2 v_tex_coord ;
out vec4 fragColor;

mat3 calculateTerrainData(vec2 uv, float center_h) {
    // すべてu_height_map_centerのみからサンプリング
    vec2 pixel_size = vec2(1.0) / u_resolution;
    mat3 _h_mat = mat3(0.0);

    _h_mat[0][0] = texture(u_texArray, uv + vec2(-pixel_size.x, -pixel_size.y)).r;
    _h_mat[0][1] = texture(u_texArray, uv + vec2(0.0, -pixel_size.y)).r;
    _h_mat[0][2] = texture(u_texArray, uv + vec2(pixel_size.x, -pixel_size.y)).r;

    _h_mat[1][0] = texture(u_texArray, uv + vec2(-pixel_size.x, 0.0)).r;
    _h_mat[1][1] = center_h;
    _h_mat[1][2] = texture(u_texArray, uv + vec2(pixel_size.x, 0.0)).r;

    _h_mat[2][0] = texture(u_texArray, uv + vec2(-pixel_size.x, pixel_size.y)).r;
    _h_mat[2][1] = texture(u_texArray, uv + vec2(0.0, pixel_size.y)).r;
    _h_mat[2][2] = texture(u_texArray, uv + vec2(pixel_size.x, pixel_size.y)).r;

    return _h_mat;
}

vec3 encodeHeight(float height) {
    if (u_dem_type == 0.0) {  // mapbox (Terrain-RGB)
        // 逆算式: value = (height + 10000.0) * 10.0
        float value = (height + 10000.0) * 10.0;

        float r = floor(value / 65536.0);
        float g = floor(mod(value, 65536.0) / 256.0);
        float b = mod(value, 256.0);

        return vec3(r, g, b) / 255.0;

    } else if (u_dem_type == 1.0) {  // gsi (地理院標高タイル)
        // 無効値 (-9999m) の処理
        if (height == -9999.0) {
            return vec3(128.0, 0.0, 0.0) / 255.0;
        }

        // 逆算式: 標高を100倍し、負の場合は 2^24 を足す
        float total = height * 100.0;
        if (total < 0.0) {
            total += 16777216.0; // 2^24
        }
        
        float r = floor(total / 65536.0);
        float g = floor(mod(total, 65536.0) / 256.0);
        float b = mod(total, 256.0);

        return vec3(r, g, b) / 255.0;

    } else if (u_dem_type == 2.0) {  // terrarium (Terrarium-RGB)
        // 逆算式: value = height + 32768.0
        float value = height + 32768.0;
        value = clamp(value, 0.0, 65535.0); // 16bit範囲

        float r = floor(value / 256.0);
        float g = mod(value, 256.0);
        float b = floor(fract(height + 32768.0) * 256.0);

        return vec3(r, g, b) / 255.0;
    }

    // 不明なタイプの場合は黒を返す
    return vec3(0.0, 0.0, 0.0);
}


void main() {
    vec2 uv = v_tex_coord;
	float h = texture(u_texArray, uv).r;

    if(h == -9999.0) {
        // -9999 の場合は透明にする
        fragColor = vec4(0.0, 0.0, 0.0, 0.0);
        return;
    }

    mat3 h_mat = calculateTerrainData(uv, h);

    vec3 agb = encodeHeight(h); // 高度をエンコード（使用しないが、計算のために呼び出す）



        // 法線の計算
    float dx = (h_mat[0][0] + h_mat[0][1] + h_mat[0][2]) - 
                    (h_mat[2][0] + h_mat[2][1] + h_mat[2][2]);
    float dy = (h_mat[0][0] + h_mat[1][0] + h_mat[2][0]) - 
                    (h_mat[0][2] + h_mat[1][2] + h_mat[2][2]);
    vec3 normal = normalize(cross(vec3(1.0, 0.0, dx), vec3(0.0, 1.0, dy)));
    // 法線の長さを調整
    normal = normalize(normal) * 0.5 + 0.5; // 法線を0-1の範囲に変換

    // 法線を使ってライティング計算
    vec3 lightDirection = normalize(vec3(0.5, 1.0, 0.3)); // ライトの方向
    float NdotL = max(dot(normal, lightDirection), 0.0); // ライトとの角度
    float ambient = 0.3; // 環境光の強さ
    float lighting = ambient + NdotL * 0.7; // 全体の明度
    // 基本色に陰影を適用
    vec3 baseColor = vec3(0.5, 0.5, 0.5); // 基本色（グレースケール）
    vec3 shadedColor = baseColor * lighting; // 陰影を適用


	float normalized = clamp((h - u_min) / (u_max - u_min), 0.0, 1.0);
    // グレースケールで出力
    vec4 value_color = vec4(vec3(agb), 1.0);


    fragColor = value_color; // グレースケールで出力

}