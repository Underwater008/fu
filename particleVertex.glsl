// Particle vertex shader — billboarded instanced quads
// Uses instanceMatrix from Three.js InstancedMesh (set via setMatrixAt)

attribute vec3 instanceColor;     // RGB normalized 0-1
attribute float instanceAlpha;
attribute vec2 instanceUV;        // atlas cell UV offset
attribute float instanceScale;    // quad size in world units

uniform vec2 cellSize;            // UV size of one atlas cell (1/cols, 1/rows)

varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;

void main() {
    // Extract world position from instanceMatrix (translation column)
    vec4 worldPos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);

    // Transform to view space
    vec4 mvPosition = modelViewMatrix * worldPos;

    // Billboard: expand unit quad in view space (always faces camera)
    mvPosition.xy += position.xy * instanceScale;

    gl_Position = projectionMatrix * mvPosition;

    // Map quad UV (0..1) into this character's atlas cell
    vUv = instanceUV + uv * cellSize;
    vColor = instanceColor;
    vAlpha = instanceAlpha;
}
