(function(){"use strict";var T=`#version 300 es
in vec4 a_position;
out vec2 v_tex_coord;

void main() {
    gl_Position = a_position;
    v_tex_coord = vec2(a_position.x * 0.5 + 0.5, a_position.y * -0.5 + 0.5);
}`,y=`#version 300 es
precision highp float;

uniform sampler2D u_texArray;
uniform vec2 u_resolution;
uniform float u_dem_type; // 0: mapbox, 1: gsi, 2: terrarium
uniform float u_min;
uniform float u_max;
uniform vec3 u_min_color; // [r, g, b] 0-1 range
uniform vec3 u_max_color;
uniform vec4 u_bbox_4326; // [minLng, minLat, maxLng, maxLat]

in vec2 v_tex_coord ;
out vec4 fragColor;

float R = 6378137.0; // メルカトル投影の地球半径

// 経度→メルカトルX
float lngToX(float lng) {
    return radians(lng) * R;
}

// 緯度→メルカトルY
float latToY(float lat) {
    return R * log(tan(radians(lat) * 0.5 + 3.14159265 / 4.0));
}

// メルカトルY→緯度（逆変換）
float yToLat(float y) {
    return degrees(2.0 * atan(exp(y / R)) - 3.14159265 / 2.0);
}

mat3 calculateTerrainData(vec2 uv, float center_h) {

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

//法線の計算
vec3 calculateNormal(mat3 _h_mat) {
          // 法線の計算
    float dx = (_h_mat[0][0] + _h_mat[0][1] + _h_mat[0][2]) - 
                    (_h_mat[2][0] + _h_mat[2][1] + _h_mat[2][2]);
    float dy = (_h_mat[0][0] + _h_mat[1][0] + _h_mat[2][0]) - 
                    (_h_mat[0][2] + _h_mat[1][2] + _h_mat[2][2]);
    vec3 normal = normalize(cross(vec3(1.0, 0.0, dx), vec3(0.0, 1.0, dy)));
    // 法線の長さを調整
    normal = normalize(normal) * 0.5 + 0.5; // 法線を0-1の範囲に変換

    return normal;
}

// ライティング計算関数　nomalを使ってライティング計算を行う
vec3 calculateLighting(vec3 normal) {
        // 法線を使ってライティング計算
    vec3 lightDirection = normalize(vec3(0.5, 1.0, 0.3)); // ライトの方向
    float NdotL = max(dot(normal, lightDirection), 0.0); // ライトとの角度
    float ambient = 0.3; // 環境光の強さ
    float lighting = ambient + NdotL * 0.7; // 全体の明度
    // 基本色に陰影を適用
    vec3 baseColor = vec3(0.5, 0.5, 0.5); // 基本色（グレースケール）
    vec3 shadedColor = baseColor * lighting; // 陰影を適用  
    return shadedColor;
}



void main() {
    vec2 uv = v_tex_coord;

    // 表示側（メルカトル）Y
    float maxY = latToY(u_bbox_4326.w);
    float minY = latToY(u_bbox_4326.y);
    float y = mix(maxY, minY, uv.y); // メルカトルY座標

    // 表示側（メルカトル）X → 経度
    float lng = mix(u_bbox_4326.x, u_bbox_4326.z, uv.x);
    float lat = yToLat(y);

    // 緯度・経度 → UVに再マッピング
    float u = (lng - u_bbox_4326.x) / (u_bbox_4326.z - u_bbox_4326.x);
    float v = (u_bbox_4326.w - lat) / (u_bbox_4326.w - u_bbox_4326.y);

    vec2 src_uv = vec2(u, v);
	float h = texture(u_texArray, src_uv).r;

    if(h == -9999.0) {
        // -9999 の場合は透明にする
        fragColor = vec4(0.0, 0.0, 0.0, 0.0);
        return;
    }

	float normalized = clamp((h - u_min) / (u_max - u_min), 0.0, 1.0);
   
    vec3 color = mix(u_min_color, u_max_color, normalized);
    
    vec4 value_color = vec4(vec3(color), 1.0);

    fragColor = value_color; // グレースケールで出力

}`;const o={u_resolution:[1,1],u_bbox_4326:[0,0,0,0],u_min:0,u_max:100,u_max_color:{r:1,g:1,b:1},u_min_color:{r:0,g:0,b:0},u_dem_type:0,u_time:0,u_scale:1};let u,l=null,e=null,i=new Map,x=0;self.onmessage=n=>{switch(n.data.type){case"init":L(n);break;case"add":R(n.data.option);break;case"updateUniforms":f(n.data.key,n.data.value);break;default:console.warn(`Unknown message type: ${n.data.type}`);break}};const E=()=>{if(!e||!l)return;["u_resolution","u_bbox_4326","u_min","u_max","u_max_color","u_min_color","u_dem_type","u_time","u_scale","u_texArray"].forEach(r=>{const a=e.getUniformLocation(l,r);i.set(r,a)})},v=n=>[n.r,n.g,n.b],f=(n,r)=>{if(!e)return;n&&r!==void 0&&(o[n]=r);const a=i.get("u_resolution");a&&e.uniform2fv(a,o.u_resolution);const t=i.get("u_bbox_4326");t&&e.uniform4fv(t,o.u_bbox_4326);const _=i.get("u_min");_&&e.uniform1f(_,o.u_min);const c=i.get("u_max");c&&e.uniform1f(c,o.u_max);const m=i.get("u_max_color");m&&e.uniform3fv(m,v(o.u_max_color));const s=i.get("u_min_color");s&&e.uniform3fv(s,v(o.u_min_color));const d=i.get("u_dem_type");d&&e.uniform1i(d,o.u_dem_type);const g=i.get("u_time");g&&e.uniform1f(g,o.u_time);const b=i.get("u_scale");b&&e.uniform1f(b,o.u_scale);const p=i.get("u_texArray");p&&e.uniform1i(p,0)},h=(n,r,a)=>{const t=n.createShader(r);return t?(n.shaderSource(t,a),n.compileShader(t),n.getShaderParameter(t,n.COMPILE_STATUS)?t:(console.error(n.getShaderInfoLog(t)),n.deleteShader(t),null)):null},A=(n,r,a)=>{const t=n.createProgram();return n.attachShader(t,r),n.attachShader(t,a),n.linkProgram(t),n.getProgramParameter(t,n.LINK_STATUS)?t:(console.error(n.getProgramInfoLog(t)),n.deleteProgram(t),null)},L=n=>{if(u=n.data.canvas,!u)throw new Error("Canvas element not found.");if(e=u.getContext("webgl2"),!e)throw new Error("WebGL context could not be initialized.");const r=h(e,e.VERTEX_SHADER,T),a=h(e,e.FRAGMENT_SHADER,y);if(!r||!a)throw new Error("Failed to create shaders.");if(l=A(e,r,a),!l)throw new Error("Failed to create WebGL program.");E(),e.useProgram(l);const t=e.getAttribLocation(l,"a_position"),_=e.createBuffer();e.bindBuffer(e.ARRAY_BUFFER,_),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),e.STATIC_DRAW),e.enableVertexAttribArray(t),e.vertexAttribPointer(t,2,e.FLOAT,!1,0,0),w()},R=n=>{if(!e||!l)return;const{array:r,bbox:a,height:t,width:_,min:c,max:m}=n;u.width=_,u.height=t,e.viewport(0,0,u.width,u.height);const s=e.createTexture();e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,s),e.texImage2D(e.TEXTURE_2D,0,e.R32F,_,t,0,e.RED,e.FLOAT,r),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),o.u_resolution=[_,t],o.u_bbox_4326=a,o.u_min=c,o.u_max=m,o.u_dem_type=0,f(),self.postMessage({type:"update",uniforms:o})},S=()=>{e&&(f(),e.drawArrays(e.TRIANGLES,0,6))},w=()=>{x=Date.now();const n=()=>{o.u_time=(Date.now()-x)/1e3,S(),requestAnimationFrame(n)};n()}})();
