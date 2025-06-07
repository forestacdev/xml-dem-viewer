//uniform 変数としてテクスチャのデータを受け取る

// vertexShaderで処理されて渡されるテクスチャ座標
varying vec3 vPosition;
varying vec3 vNormal;
varying vec2 vUv;
varying mat4 vModelMatrix;
uniform vec3 uColor;

varying mat4 v_modelMatrix;
varying float v_fogDistance;


void main(){
    // ライトの方向（上から斜めに当たる）
    vec3 lightDirection = normalize(vec3(0.5, 1.0, 0.3));
    
    // 基本的なランバート拡散光
    float NdotL = max(dot(normalize(vNormal), lightDirection), 0.0);
    
    // 環境光
    float ambient = 0.3;
    
    // 全体の明度
    float lighting = ambient + NdotL * 0.7;
    
    // 基本色に陰影を適用
    vec3 baseColor = uColor;
    vec3 shadedColor = baseColor * lighting;
    
    gl_FragColor = vec4(shadedColor, 1.0);
}