import * as THREE from "three";

export interface UniformValues {
    u_color: THREE.Color;
    u_scale: number;
}

export const uniforms = {
    u_color: { value: new THREE.Color("rgb(255,255,255)") },
    u_scale: { value: 1.0 },
};
