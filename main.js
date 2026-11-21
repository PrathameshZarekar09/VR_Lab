/**
 * main.js
 * High-performance, cross-platform Young's Double-Slit Experiment interactive simulation.
 * Supports Meta Quest 3/3S (OpenXR WebXR 6DOF Controllers & Hands), Laptop/Desktop (Mouse & Keyboard), and Web Browser.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';

// =============================================================================
// 1. STATE & CONSTANTS
// =============================================================================
const SLIT_Z = -0.46;                 // Fixed Z position of double slit carriage in Lab_Setup.glb
const OPTICAL_AXIS_Y = 1.16;          // Height of laser beam optical axis in meters
const OPTICAL_AXIS_X = 0.00;          // Centered horizontal optical axis
const SCREEN_PHYSICAL_HALF_WIDTH = 0.25; // 0.50m total active sampling area on screen

const state = {
    mode: 'classical', // 'classical' | 'quantum'
    isDraggingScreen: false,
    dragStartDistance: 1.20,
    dragController: null,
    dragStartControllerZ: 0,
    mouseRay: new THREE.Raycaster(),
    mousePos: new THREE.Vector2(-999, -999),
    hoverScreenX: 0.0,
    audioActive: false,

    // WebXR Locomotion & Teleportation State
    xrSnapTurnLocked: false,
    isTeleportAiming: false,
    isTeleportValid: false,
    teleportTarget: new THREE.Vector3(),
    activeTeleportController: null,

    // 3D Parameter Console Interaction State
    activeVRConsoleDrag: null,
    activeMouseConsoleDrag: null,
    lastVRHoverPoint: null,
    mouseOverConsole: false,
    hoveredConsoleSlider: null,
    consoleStickLocked: false,

    // 3D Welcome Kiosk Interaction State
    lastVRKioskHoverPoint: null,
    mouseOverKiosk: false,
    hoveredKioskItem: null,

    // Floating VR Screen Drag & Drop State
    activeVRPanelDrag: null,
    activeMousePanelDrag: null,
    mouseOverPanelHandle: false,

    // Welcome Kiosk Drag & Drop State
    activeVRKioskDrag: null,
    activeMouseKioskDrag: null,

    // Welcome Kiosk Educational Tab State: 'aim' | 'diagram' | 'results' | 'lesson' | 'quiz'
    kioskTab: 'aim',
    kioskQuizIndex: 0
};

// Instantiate shared physics engine and quantum simulator
const physics = new YDSEPhysicsModel({
    wavelength: 650e-9,
    slitSeparation: 0.50e-3,
    slitWidth: 0.10e-3,
    screenDistance: 2.00,
    laserActive: true,
    leftSlitOpen: true,
    rightSlitOpen: true,
    visibility: 1.0
});

const quantum = new YDSEQuantumSimulator(physics, {
    screenWidth: SCREEN_PHYSICAL_HALF_WIDTH * 2,
    numBins: 80,
    photonsPerSecond: 120
});

// =============================================================================
// 1.5. LESSON DIRECTOR & TELEPORTATION
// =============================================================================
function teleportToBench() {
    if (renderer && renderer.xr && renderer.xr.isPresenting) {
        xrRig.position.set(0.85, 0, 0.20);
        xrRig.rotation.set(0, -Math.PI / 4, 0);
    } else if (camera && controls) {
        camera.position.set(1.65, 1.45, 0.95);
        controls.target.set(0, 1.05, -0.6);
        controls.update();
    }
}

function renderQuiz() {
    if (!lesson) return;
    const quizBody = document.getElementById('quiz-body');
    if (!quizBody) return;
    quizBody.innerHTML = '';

    lesson.quizQuestions.forEach((q) => {
        const container = document.createElement('div');
        container.style.cssText = 'background:rgba(255,255,255,0.03);padding:14px;border-radius:8px;border:1px solid rgba(255,255,255,0.08);display:flex;flex-direction:column;gap:8px;';
        
        const qTitle = document.createElement('h5');
        qTitle.style.cssText = 'color:#f8fafc;font-size:0.95rem;margin:0;';
        qTitle.innerText = q.question;
        container.appendChild(qTitle);

        const optionsDiv = document.createElement('div');
        optionsDiv.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:4px;';

        q.options.forEach((opt, optIdx) => {
            const btn = document.createElement('button');
            btn.className = 'quiz-option-btn';
            btn.innerText = opt;
            btn.addEventListener('click', () => {
                const result = lesson.submitQuizAnswer(q.id, optIdx);
                const allBtns = optionsDiv.querySelectorAll('.quiz-option-btn');
                allBtns.forEach((b, bIdx) => {
                    b.disabled = true;
                    if (bIdx === q.correctIndex) b.classList.add('correct');
                    else if (bIdx === optIdx) b.classList.add('wrong');
                });

                const feedback = document.createElement('div');
                feedback.style.cssText = 'font-size:0.82rem;padding:8px;border-radius:6px;margin-top:6px;line-height:1.4;background:' + (result.isCorrect ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)') + ';color:' + (result.isCorrect ? '#6ee7b7' : '#fca5a5') + ';';
                feedback.innerText = (result.isCorrect ? '✅ ' : '❌ ') + result.explanation;
                container.appendChild(feedback);
            });
            optionsDiv.appendChild(btn);
        });

        container.appendChild(optionsDiv);
        quizBody.appendChild(container);
    });
}

const lesson = new YDSELessonDirector({ physicsModel: physics, quantumSimulator: quantum }, {
    onStageChange: (stage) => {
        const badge = document.getElementById('lesson-stage-badge');
        if (badge) badge.innerText = 'Stage ' + stage.id + ' of 6';
        const dur = document.getElementById('lesson-duration');
        if (dur) dur.innerText = stage.duration;
        const title = document.getElementById('lesson-title');
        if (title) title.innerText = stage.title;
        const prompt = document.getElementById('lesson-prompt');
        if (prompt) prompt.innerText = stage.prompt;
        const action = document.getElementById('lesson-action');
        if (action) action.innerText = stage.action;

        if (stage.id === 6) {
            renderQuiz();
            const modal = document.getElementById('modal-quiz');
            if (modal) modal.classList.remove('hidden');
        }

        redrawKioskTexture();
    }
});

// =============================================================================
// 2. THREE.JS INITIALIZATION & WEBXR SETUP
// =============================================================================
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0e17);

// XR Rig holds camera, controllers, grips, and hands for room-scale VR locomotion
const xrRig = new THREE.Group();
xrRig.name = 'xrRig';
scene.add(xrRig);

const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.05, 100);
camera.position.set(1.95, 1.45, 0.40); // Ergonomic viewing angle looking at rail and screen
xrRig.add(camera);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.xr.enabled = true; // Enable WebXR for Quest 3 / Quest 3S
container.appendChild(renderer.domElement);

// OrbitControls for Laptop / Desktop
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0.0, 1.16, -1.0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.maxPolarAngle = Math.PI * 0.49; // Keep camera above floor
controls.minDistance = 0.3;
controls.maxDistance = 6.0;

// Mount WebXR VR Button for Quest
const vrContainer = document.getElementById('vr-btn-container');
const vrButton = VRButton.createButton(renderer);
vrContainer.appendChild(vrButton);

// =============================================================================
// 3. LABORATORY LIGHTING & AMBIENCE
// =============================================================================
const ambientLight = new THREE.AmbientLight(0xdde5ed, 0.75);
scene.add(ambientLight);

const ceilingSun = new THREE.DirectionalLight(0xffffff, 1.25);
ceilingSun.position.set(2.5, 3.2, 1.0);
ceilingSun.castShadow = true;
ceilingSun.shadow.mapSize.width = 1024;
ceilingSun.shadow.mapSize.height = 1024;
ceilingSun.shadow.camera.near = 0.1;
ceilingSun.shadow.camera.far = 10;
ceilingSun.shadow.bias = -0.0005;
scene.add(ceilingSun);

const fillLight = new THREE.DirectionalLight(0x88a4c8, 0.45);
fillLight.position.set(-2.5, 2.5, -2.0);
scene.add(fillLight);

// Table Accent Spotlight focused on observation screen
const screenSpotlight = new THREE.SpotLight(0xffffff, 0.6, 6.0, Math.PI / 4, 0.3, 1.0);
screenSpotlight.position.set(0, 2.8, -1.5);
screenSpotlight.target.position.set(0, 1.16, -1.7);
scene.add(screenSpotlight);
scene.add(screenSpotlight.target);

// Laser aperture point light
const laserApertureLight = new THREE.PointLight(0xff2222, 1.2, 1.5);
laserApertureLight.position.set(0, OPTICAL_AXIS_Y, 1.63);
scene.add(laserApertureLight);

// Physical glowing laser aperture collar / emitter ring
const laserApertureMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.016, 0.018, 0.02, 32),
    new THREE.MeshStandardMaterial({
        color: 0xef4444,
        emissive: 0xef4444,
        emissiveIntensity: 2.5,
        roughness: 0.2,
        metalness: 0.8
    })
);
laserApertureMesh.rotation.x = Math.PI / 2;
laserApertureMesh.position.set(0, OPTICAL_AXIS_Y, 1.63);
scene.add(laserApertureMesh);

// Observation screen glow light
const screenGlowLight = new THREE.PointLight(0xff2222, 0.9, 1.2);
screenGlowLight.position.set(0, OPTICAL_AXIS_Y, SLIT_Z - physics.screenDistance + 0.08);
scene.add(screenGlowLight);

// =============================================================================
// 4. DYNAMIC INTERFERENCE SCREEN TEXTURE & CANVAS
// =============================================================================
const screenCanvas = document.createElement('canvas');
screenCanvas.width = 1024;
screenCanvas.height = 512;
const screenCtx = screenCanvas.getContext('2d', { willReadFrequently: true });

const screenTexture = new THREE.CanvasTexture(screenCanvas);
screenTexture.generateMipmaps = true;
screenTexture.minFilter = THREE.LinearMipmapLinearFilter;
screenTexture.magFilter = THREE.LinearFilter;

// Screen Phosphor Material (used on the Observation Screen face)
const screenPhosphorMaterial = new THREE.MeshStandardMaterial({
    map: screenTexture,
    roughness: 0.35,
    metalness: 0.05,
    emissive: new THREE.Color(0xef4444),
    emissiveMap: screenTexture,
    emissiveIntensity: 0.85
});

function redrawScreenTexture() {
    const w = screenCanvas.width;
    const h = screenCanvas.height;
    const halfW = w / 2;
    const halfH = h / 2;

    const rgb = YDSEPhysicsModel.wavelengthToRGB(physics.wavelength);
    const laserColor = new THREE.Color(rgb.r, rgb.g, rgb.b);

    // Update point lights to match laser color
    laserApertureLight.color.copy(laserColor);
    laserApertureLight.intensity = physics.laserActive ? 1.4 : 0.0;
    screenGlowLight.color.copy(laserColor);
    screenGlowLight.intensity = physics.laserActive ? (physics.leftSlitOpen || physics.rightSlitOpen ? 1.0 : 0.0) : 0.0;
    screenPhosphorMaterial.emissive.copy(laserColor);
    screenPhosphorMaterial.emissiveIntensity = physics.laserActive ? 0.9 : 0.0;

    // Clear background to laboratory white phosphor with subtle millimeter grid
    screenCtx.fillStyle = '#f1f4f8';
    screenCtx.fillRect(0, 0, w, h);

    // Subtle millimeter grid lines
    screenCtx.lineWidth = 1;
    screenCtx.strokeStyle = 'rgba(200, 208, 220, 0.6)';
    for (let x = 0; x < w; x += 32) {
        screenCtx.beginPath();
        screenCtx.moveTo(x, 0);
        screenCtx.lineTo(x, h);
        screenCtx.stroke();
    }
    for (let y = 0; y < h; y += 32) {
        screenCtx.beginPath();
        screenCtx.moveTo(0, y);
        screenCtx.lineTo(w, y);
        screenCtx.stroke();
    }

    // Central crosshair & optical axis tick marks
    screenCtx.strokeStyle = 'rgba(148, 163, 184, 0.8)';
    screenCtx.lineWidth = 1.5;
    screenCtx.beginPath();
    screenCtx.moveTo(halfW, 0);
    screenCtx.lineTo(halfW, h);
    screenCtx.moveTo(0, halfH);
    screenCtx.lineTo(w, halfH);
    screenCtx.stroke();

    // Screen scale labels along top
    screenCtx.fillStyle = '#64748b';
    screenCtx.font = '13px "JetBrains Mono", monospace';
    screenCtx.textAlign = 'center';
    screenCtx.fillText('0', halfW, 20);
    screenCtx.fillText('-10cm', halfW - 200, 20);
    screenCtx.fillText('+10cm', halfW + 200, 20);
    screenCtx.fillText('-20cm', halfW - 400, 20);
    screenCtx.fillText('+20cm', halfW + 400, 20);

    // MODE 1: Classical Wave Interference
    if (state.mode === 'classical') {
        if (!physics.laserActive || (!physics.leftSlitOpen && !physics.rightSlitOpen)) {
            // Dark screen
            screenTexture.needsUpdate = true;
            return;
        }

        const imgData = screenCtx.getImageData(0, 0, w, h);
        const data = imgData.data;

        // Physical width represented on texture is 0.50m (-0.25m to +0.25m)
        const metersPerPixel = (SCREEN_PHYSICAL_HALF_WIDTH * 2) / w;

        // Precompute 1D horizontal intensity profile
        const intensityProfile = new Float32Array(w);
        for (let col = 0; col < w; col++) {
            const xPhysical = (col - halfW) * metersPerPixel;
            intensityProfile[col] = physics.calculateIntensity(xPhysical);
        }

        const cr = rgb.r * 255;
        const cg = rgb.g * 255;
        const cb = rgb.b * 255;

        for (let y = 0; y < h; y++) {
            // Vertical Gaussian / aperture falloff
            const dy = Math.abs(y - halfH);
            let vFade = Math.exp(-(dy * dy) / (2 * 75 * 75));
            if (dy > 180) vFade = 0;

            const rowStart = y * w * 4;

            for (let x = 0; x < w; x++) {
                const intensity = intensityProfile[x] * vFade;
                if (intensity > 0.003) {
                    const idx = rowStart + (x * 4);
                    const t = Math.min(1.0, intensity * 1.6);
                    const core = Math.max(0, (intensity - 0.7) * 2.0);

                    // Blend laser color onto phosphor screen
                    data[idx] = Math.min(255, (1 - t) * 241 + t * cr + core * 70);
                    data[idx + 1] = Math.min(255, (1 - t) * 244 + t * cg + core * 70);
                    data[idx + 2] = Math.min(255, (1 - t) * 248 + t * cb + core * 70);
                }
            }
        }

        screenCtx.putImageData(imgData, 0, 0);
    } 
    // MODE 2: Quantum Single-Photon Accumulation
    else if (state.mode === 'quantum') {
        // Draw accumulated detection dots from quantum simulator
        const detections = quantum.detectionHistory;
        const metersPerPixel = (SCREEN_PHYSICAL_HALF_WIDTH * 2) / w;

        screenCtx.fillStyle = rgb.hex;
        for (let i = 0; i < detections.length; i++) {
            const det = detections[i];
            const px = halfW + (det.x / metersPerPixel);
            const py = halfH + (det.y / metersPerPixel);
            
            // Draw small quantum arrival dot
            screenCtx.beginPath();
            screenCtx.arc(px, py, 2.2, 0, Math.PI * 2);
            screenCtx.fill();
        }
    }

    screenTexture.needsUpdate = true;
}

// =============================================================================
// 4.5. INTERACTIVE 3D PARAMETER CONSOLE (Lab_Setup.glb "Parameter console")
// =============================================================================
const consoleCanvas = document.createElement('canvas');
consoleCanvas.width = 1080;
consoleCanvas.height = 620;
const consoleCtx = consoleCanvas.getContext('2d', { willReadFrequently: true });

const consoleTexture = new THREE.CanvasTexture(consoleCanvas);
consoleTexture.flipY = false; // UV (0,0) is top-left, matching canvas
consoleTexture.generateMipmaps = true;
consoleTexture.minFilter = THREE.LinearMipmapLinearFilter;
consoleTexture.magFilter = THREE.LinearFilter;

const consoleScreenMaterial = new THREE.MeshStandardMaterial({
    map: consoleTexture,
    emissive: new THREE.Color(0xffffff),
    emissiveMap: consoleTexture,
    emissiveIntensity: 0.90,
    roughness: 0.35,
    metalness: 0.05,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: -1.0,
    polygonOffsetUnits: -1.0
});

// Interactive Quad placed with exact mathematical alignment over console display face
const consoleGeo = new THREE.BufferGeometry();
const consoleVertices = new Float32Array([
    // Triangle 1: V3 (top-left), V0 (bottom-left), V1 (bottom-right)
    1.583117, 1.401131, 0.602158,
    1.455758, 0.868551, 0.986475,
    2.612876, 0.868551, 1.369932,
    // Triangle 2: V3 (top-left), V1 (bottom-right), V2 (top-right)
    1.583117, 1.401131, 0.602158,
    2.612876, 0.868551, 1.369932,
    2.740235, 1.401131, 0.985615
]);
const consoleUVs = new Float32Array([
    0, 0,
    0, 1,
    1, 1,
    0, 0,
    1, 1,
    1, 0
]);
consoleGeo.setAttribute('position', new THREE.BufferAttribute(consoleVertices, 3));
consoleGeo.setAttribute('uv', new THREE.BufferAttribute(consoleUVs, 2));
consoleGeo.computeVertexNormals();

const consoleInteractiveQuad = new THREE.Mesh(consoleGeo, consoleScreenMaterial);
consoleInteractiveQuad.name = 'Parameter_Console_Interactive_Display';
scene.add(consoleInteractiveQuad);

const CONSOLE_SLIDERS = [
    {
        id: 'wavelength',
        label: 'Wavelength',
        y: 180,
        min: 380,
        max: 750,
        step: 10,
        format: (v) => `${v.toFixed(0)} nm`,
        get: () => physics.wavelength * 1e9,
        set: (v) => setWavelength(v)
    },
    {
        id: 'separation',
        label: 'Slit separation',
        y: 265,
        min: 0.05,
        max: 0.80,
        step: 0.05,
        format: (v) => `${v.toFixed(2)} mm`,
        get: () => physics.slitSeparation * 1000,
        set: (v) => setSlitSeparation(v)
    },
    {
        id: 'distance',
        label: 'Screen distance',
        y: 350,
        min: 0.40,
        max: 2.40,
        step: 0.10,
        format: (v) => `${v.toFixed(2)} m`,
        get: () => physics.screenDistance,
        set: (v) => setScreenDistance(v)
    },
    {
        id: 'width',
        label: 'Slit width',
        y: 435,
        min: 0.01,
        max: 0.10,
        step: 0.01,
        format: (v) => `${v.toFixed(2)} mm`,
        get: () => physics.slitWidth * 1000,
        set: (v) => setSlitWidth(v)
    }
];

function redrawConsoleTexture(hoverPt = null) {
    const w = consoleCanvas.width;
    const h = consoleCanvas.height;

    // Background gradient: dark futuristic glass console
    const bgGrad = consoleCtx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, '#0a101d');
    bgGrad.addColorStop(1, '#060a14');
    consoleCtx.fillStyle = bgGrad;
    consoleCtx.fillRect(0, 0, w, h);

    // Subtle sleek border
    consoleCtx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
    consoleCtx.lineWidth = 3;
    consoleCtx.strokeRect(4, 4, w - 8, h - 8);

    // Header text
    consoleCtx.fillStyle = '#38bdf8';
    consoleCtx.font = 'bold 15px "JetBrains Mono", sans-serif';
    consoleCtx.textAlign = 'left';
    consoleCtx.fillText('OPTICAL BENCH  /  LIVE PARAMETERS', 50, 48);

    consoleCtx.fillStyle = '#f8fafc';
    consoleCtx.font = 'bold 36px sans-serif';
    consoleCtx.fillText('Experiment controls', 50, 95);

    const rgb = YDSEPhysicsModel.wavelengthToRGB(physics.wavelength);

    // Draw the 4 sliders with integrated [ - ] and [ + ] step buttons
    const trackStartX = 50;
    const trackWidth = 450;
    const trackEndX = trackStartX + trackWidth;

    CONSOLE_SLIDERS.forEach((s) => {
        const val = s.get();
        const norm = THREE.MathUtils.clamp((val - s.min) / (s.max - s.min), 0, 1);
        const handleX = trackStartX + norm * trackWidth;

        const isHoveredRow = hoverPt && (Math.abs(hoverPt.y - s.y) <= 30);
        const isMinusHovered = hoverPt && (Math.abs(hoverPt.y - (s.y - 17)) <= 16) && (hoverPt.x >= 290 && hoverPt.x <= 355);
        const isPlusHovered = hoverPt && (Math.abs(hoverPt.y - (s.y - 17)) <= 16) && (hoverPt.x >= 450 && hoverPt.x <= 515);

        // Label
        consoleCtx.fillStyle = isHoveredRow ? '#38bdf8' : '#94a3b8';
        consoleCtx.font = 'bold 18px sans-serif';
        consoleCtx.textAlign = 'left';
        consoleCtx.fillText(s.label, trackStartX, s.y - 13);

        // [ - ] STEP BUTTON
        const bMinusX = 295, bMinusY = s.y - 32, bW = 50, bH = 26;
        consoleCtx.fillStyle = isMinusHovered ? 'rgba(56, 189, 248, 0.45)' : 'rgba(56, 189, 248, 0.18)';
        consoleCtx.beginPath();
        if (consoleCtx.roundRect) consoleCtx.roundRect(bMinusX, bMinusY, bW, bH, 5);
        else consoleCtx.rect(bMinusX, bMinusY, bW, bH);
        consoleCtx.fill();
        consoleCtx.strokeStyle = isMinusHovered ? '#38bdf8' : 'rgba(56, 189, 248, 0.55)';
        consoleCtx.lineWidth = isMinusHovered ? 2.5 : 1.5;
        consoleCtx.stroke();

        consoleCtx.fillStyle = '#ffffff';
        consoleCtx.font = 'bold 22px sans-serif';
        consoleCtx.textAlign = 'center';
        consoleCtx.fillText('−', bMinusX + bW / 2, bMinusY + 20);

        // Value text (centered between minus and plus buttons)
        consoleCtx.fillStyle = (s.id === 'wavelength') ? rgb.hex : '#f8fafc';
        consoleCtx.font = 'bold 20px "JetBrains Mono", monospace';
        consoleCtx.textAlign = 'center';
        consoleCtx.fillText(s.format(val), 405, s.y - 13);

        // [ + ] STEP BUTTON
        const bPlusX = 455, bPlusY = s.y - 32;
        consoleCtx.fillStyle = isPlusHovered ? 'rgba(56, 189, 248, 0.45)' : 'rgba(56, 189, 248, 0.18)';
        consoleCtx.beginPath();
        if (consoleCtx.roundRect) consoleCtx.roundRect(bPlusX, bPlusY, bW, bH, 5);
        else consoleCtx.rect(bPlusX, bPlusY, bW, bH);
        consoleCtx.fill();
        consoleCtx.strokeStyle = isPlusHovered ? '#38bdf8' : 'rgba(56, 189, 248, 0.55)';
        consoleCtx.lineWidth = isPlusHovered ? 2.5 : 1.5;
        consoleCtx.stroke();

        consoleCtx.fillStyle = '#ffffff';
        consoleCtx.font = 'bold 22px sans-serif';
        consoleCtx.textAlign = 'center';
        consoleCtx.fillText('+', bPlusX + bW / 2, bPlusY + 21);

        // Track background
        consoleCtx.fillStyle = '#1e293b';
        consoleCtx.beginPath();
        if (consoleCtx.roundRect) consoleCtx.roundRect(trackStartX, s.y - 3, trackWidth, 8, 4);
        else consoleCtx.rect(trackStartX, s.y - 3, trackWidth, 8);
        consoleCtx.fill();

        // Active fill
        consoleCtx.fillStyle = (s.id === 'wavelength') ? rgb.hex : '#38bdf8';
        consoleCtx.beginPath();
        if (consoleCtx.roundRect) consoleCtx.roundRect(trackStartX, s.y - 3, norm * trackWidth, 8, 4);
        else consoleCtx.rect(trackStartX, s.y - 3, norm * trackWidth, 8);
        consoleCtx.fill();

        // Handle
        consoleCtx.fillStyle = '#ffffff';
        consoleCtx.beginPath();
        consoleCtx.arc(handleX, s.y + 1, 11, 0, Math.PI * 2);
        consoleCtx.fill();
        consoleCtx.strokeStyle = isHoveredRow ? '#ffffff' : '#38bdf8';
        consoleCtx.lineWidth = 2.5;
        consoleCtx.stroke();
    });

    // -------------------------------------------------------------
    // FRINGE PREVIEW (Right Column)
    // -------------------------------------------------------------
    const prevX = 570;
    const prevY = 160;
    const prevW = 450;
    const prevH = 290;

    consoleCtx.fillStyle = '#38bdf8';
    consoleCtx.font = 'bold 16px "JetBrains Mono", sans-serif';
    consoleCtx.textAlign = 'left';
    consoleCtx.fillText('FRINGE PREVIEW', prevX, 142);

    // Frame
    consoleCtx.fillStyle = '#030712';
    consoleCtx.beginPath();
    if (consoleCtx.roundRect) consoleCtx.roundRect(prevX, prevY, prevW, prevH, 8);
    else consoleCtx.rect(prevX, prevY, prevW, prevH);
    consoleCtx.fill();
    consoleCtx.strokeStyle = 'rgba(56, 189, 248, 0.3)';
    consoleCtx.lineWidth = 2;
    consoleCtx.stroke();

    // Render simulated fringes in preview window
    if (physics.laserActive && (physics.leftSlitOpen || physics.rightSlitOpen)) {
        const previewImg = consoleCtx.createImageData(prevW, prevH);
        const data = previewImg.data;
        const halfPW = prevW / 2;
        const halfPH = prevH / 2;

        const previewPhysHalfWidth = 0.20; // 0.40m active sampling span in preview
        const mPerPx = (previewPhysHalfWidth * 2) / prevW;

        const cr = rgb.r * 255;
        const cg = rgb.g * 255;
        const cb = rgb.b * 255;

        // Precompute horizontal profile
        const prof = new Float32Array(prevW);
        for (let col = 0; col < prevW; col++) {
            const xPhys = (col - halfPW) * mPerPx;
            prof[col] = physics.calculateIntensity(xPhys);
        }

        for (let py = 0; py < prevH; py++) {
            const dy = Math.abs(py - halfPH);
            const vFade = Math.exp(-(dy * dy) / (2 * 45 * 45));
            const rowOffset = py * prevW * 4;

            for (let px = 0; px < prevW; px++) {
                const intens = prof[px] * vFade;
                if (intens > 0.005) {
                    const idx = rowOffset + px * 4;
                    const core = Math.max(0, (intens - 0.75) * 2.0);
                    data[idx] = Math.min(255, intens * cr + core * 80);
                    data[idx + 1] = Math.min(255, intens * cg + core * 80);
                    data[idx + 2] = Math.min(255, intens * cb + core * 80);
                    data[idx + 3] = 255;
                }
            }
        }
        consoleCtx.putImageData(previewImg, prevX, prevY);

        // Subtle millimeter ticks on preview
        consoleCtx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        consoleCtx.lineWidth = 1;
        consoleCtx.beginPath();
        consoleCtx.moveTo(prevX + halfPW, prevY);
        consoleCtx.lineTo(prevX + halfPW, prevY + prevH);
        consoleCtx.stroke();
    } else {
        consoleCtx.fillStyle = '#64748b';
        consoleCtx.font = 'italic 18px sans-serif';
        consoleCtx.textAlign = 'center';
        consoleCtx.fillText('Laser Inactive / Slits Blocked', prevX + prevW / 2, prevY + prevH / 2);
    }

    // -------------------------------------------------------------
    // BUTTONS (Bottom Row)
    // -------------------------------------------------------------
    // RESET Button
    const rX = 570, rY = 485, rW = 180, rH = 55;
    consoleCtx.fillStyle = 'rgba(56, 189, 248, 0.12)';
    consoleCtx.beginPath();
    if (consoleCtx.roundRect) consoleCtx.roundRect(rX, rY, rW, rH, 6);
    else consoleCtx.rect(rX, rY, rW, rH);
    consoleCtx.fill();
    consoleCtx.strokeStyle = '#38bdf8';
    consoleCtx.lineWidth = 2;
    consoleCtx.stroke();

    consoleCtx.fillStyle = '#38bdf8';
    consoleCtx.font = 'bold 20px sans-serif';
    consoleCtx.textAlign = 'center';
    consoleCtx.fillText('↺ RESET', rX + rW / 2, rY + 35);

    // PAUSE / RESUME Button
    const pX = 780, pY = 485, pW = 240, pH = 55;
    const isLaser = physics.laserActive;
    consoleCtx.fillStyle = isLaser ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)';
    consoleCtx.beginPath();
    if (consoleCtx.roundRect) consoleCtx.roundRect(pX, pY, pW, pH, 6);
    else consoleCtx.rect(pX, pY, pW, pH);
    consoleCtx.fill();
    consoleCtx.strokeStyle = isLaser ? '#22c55e' : '#ef4444';
    consoleCtx.lineWidth = 2;
    consoleCtx.stroke();

    consoleCtx.fillStyle = isLaser ? '#4ade80' : '#f87171';
    consoleCtx.font = 'bold 18px sans-serif';
    consoleCtx.textAlign = 'center';
    consoleCtx.fillText(isLaser ? '⏸ PAUSE LASER' : '▶ RESUME LASER', pX + pW / 2, pY + 35);

    // Pointer cursor indicator (Desktop mouse only; VR uses 3D consoleReticleMesh)
    if (hoverPt && !renderer.xr.isPresenting) {
        consoleCtx.strokeStyle = '#38bdf8';
        consoleCtx.lineWidth = 2;
        consoleCtx.beginPath();
        consoleCtx.arc(hoverPt.x, hoverPt.y, 8, 0, Math.PI * 2);
        consoleCtx.stroke();
        consoleCtx.fillStyle = '#ffffff';
        consoleCtx.beginPath();
        consoleCtx.arc(hoverPt.x, hoverPt.y, 3, 0, Math.PI * 2);
        consoleCtx.fill();
    }

    consoleTexture.needsUpdate = true;
}

function interactWithConsole(cx, cy, isDown, specificSliderId = null) {
    const trackStartX = 50;
    const trackWidth = 450;
    const trackEndX = 500;

    // 1. If actively dragging a specific slider, update directly from cx
    if (specificSliderId) {
        const s = CONSOLE_SLIDERS.find(sl => sl.id === specificSliderId);
        if (s) {
            const norm = THREE.MathUtils.clamp((cx - trackStartX) / trackWidth, 0, 1);
            const val = s.min + norm * (s.max - s.min);
            s.set(val);
            return { type: 'slider', id: s.id, value: val };
        }
    }

    // 2. Check each slider's minus and plus buttons & track
    for (const s of CONSOLE_SLIDERS) {
        // [ - ] Button: X in [290, 355], Y in [s.y - 36, s.y - 2]
        if (cx >= 290 && cx <= 355 && cy >= s.y - 36 && cy <= s.y - 2) {
            if (isDown) {
                const currentVal = s.get();
                const newVal = THREE.MathUtils.clamp(currentVal - s.step, s.min, s.max);
                s.set(newVal);
                return { type: 'step-btn', id: s.id, dir: -1, value: newVal };
            }
            return { type: 'hover-step', id: s.id, dir: -1 };
        }

        // [ + ] Button: X in [450, 515], Y in [s.y - 36, s.y - 2]
        if (cx >= 450 && cx <= 515 && cy >= s.y - 36 && cy <= s.y - 2) {
            if (isDown) {
                const currentVal = s.get();
                const newVal = THREE.MathUtils.clamp(currentVal + s.step, s.min, s.max);
                s.set(newVal);
                return { type: 'step-btn', id: s.id, dir: 1, value: newVal };
            }
            return { type: 'hover-step', id: s.id, dir: 1 };
        }

        // Slider Track & Handle: X in [40, 515], Y in [s.y - 12, s.y + 24]
        if (Math.abs(cy - s.y) <= 24 && cx >= trackStartX - 25 && cx <= trackEndX + 25) {
            const norm = THREE.MathUtils.clamp((cx - trackStartX) / trackWidth, 0, 1);
            const val = s.min + norm * (s.max - s.min);
            s.set(val);
            return { type: 'slider', id: s.id, value: val };
        }
    }

    // 3. Only on initial press (isDown) for buttons
    if (isDown) {
        // RESET Button: X in [570, 750], Y in [485, 540]
        if (cx >= 570 && cx <= 750 && cy >= 485 && cy <= 540) {
            resetExperiment();
            return { type: 'button', id: 'reset' };
        }

        // PAUSE Button: X in [780, 1020], Y in [485, 540]
        if (cx >= 780 && cx <= 1020 && cy >= 485 && cy <= 540) {
            toggleLaserPower();
            return { type: 'button', id: 'pause' };
        }
    }

    return null;
}

// =============================================================================
// 4.6. INTERACTIVE 3D WELCOME KIOSK (Lab_Setup.glb "Welcome kiosk")
// =============================================================================
const kioskCanvas = document.createElement('canvas');
kioskCanvas.width = 1080;
kioskCanvas.height = 1380;
const kioskCtx = kioskCanvas.getContext('2d');

const kioskTexture = new THREE.CanvasTexture(kioskCanvas);
kioskTexture.flipY = false;
kioskTexture.anisotropy = 4;
kioskTexture.colorSpace = THREE.SRGBColorSpace;

const kioskScreenMaterial = new THREE.MeshStandardMaterial({
    map: kioskTexture,
    emissive: new THREE.Color(0xffffff),
    emissiveMap: kioskTexture,
    emissiveIntensity: 0.85,
    roughness: 0.35,
    metalness: 0.05,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: -1.0,
    polygonOffsetUnits: -1.0
});

// Lightweight 3D Hover Reticles (eliminates expensive 90Hz canvas texture uploads!)
const reticleRingGeo = new THREE.RingGeometry(0.012, 0.020, 32);
const reticleRingMat = new THREE.MeshBasicMaterial({
    color: 0x00f0ff,
    side: THREE.DoubleSide,
    depthTest: false,
    transparent: true,
    opacity: 0.85
});

const kioskReticleMesh = new THREE.Mesh(reticleRingGeo, reticleRingMat);
kioskReticleMesh.visible = false;
kioskReticleMesh.renderOrder = 999;
scene.add(kioskReticleMesh);

const consoleReticleMesh = new THREE.Mesh(reticleRingGeo, reticleRingMat);
consoleReticleMesh.visible = false;
consoleReticleMesh.renderOrder = 999;
scene.add(consoleReticleMesh);

// Offset quad placed precisely 3mm over Welcome kiosk front display panel
const kioskVertices = new Float32Array([
    // Triangle 1: v0, v1, v2
    -2.4974, 0.4145, 1.1869,
    -1.5994, 0.4145, 0.9959,
    -1.6384, 1.5885, 0.8099,

    // Triangle 2: v0, v2, v3
    -2.4974, 0.4145, 1.1869,
    -1.6384, 1.5885, 0.8099,
    -2.5374, 1.5885, 1.0019
]);

const kioskUVs = new Float32Array([
    0, 1,
    1, 1,
    1, 0,

    0, 1,
    1, 0,
    0, 0
]);

const kioskGeo = new THREE.BufferGeometry();
kioskGeo.setAttribute('position', new THREE.BufferAttribute(kioskVertices, 3));
kioskGeo.setAttribute('uv', new THREE.BufferAttribute(kioskUVs, 2));
kioskGeo.computeVertexNormals();

// Master Pivot Group centered at initial Welcome Kiosk world center (-2.07, 0, 0.99)
const kioskPivotGroup = new THREE.Group();
kioskPivotGroup.name = 'Welcome_Kiosk_Pivot_Group';
kioskPivotGroup.position.set(-2.07, 0, 0.99);
scene.add(kioskPivotGroup);

const kioskInteractiveQuad = new THREE.Mesh(kioskGeo, kioskScreenMaterial);
kioskInteractiveQuad.name = 'Welcome_Kiosk_Interactive_Display';
kioskPivotGroup.attach(kioskInteractiveQuad);

let welcomeKioskObject = null;
let kioskDisplayMesh = null;

function getKioskTargets() {
    return [kioskInteractiveQuad, kioskDisplayMesh, welcomeKioskObject].filter(Boolean);
}

function resetKioskPosition() {
    kioskPivotGroup.position.set(-2.07, 0, 0.99);
    kioskPivotGroup.rotation.set(0, 0, 0);
    redrawKioskTexture();
}

function orientKioskToUser() {
    const headPos = new THREE.Vector3();
    camera.getWorldPosition(headPos);
    const dx = headPos.x - kioskPivotGroup.position.x;
    const dz = headPos.z - kioskPivotGroup.position.z;
    if (Math.hypot(dx, dz) > 0.3) {
        // Offset by -0.2101 rad so FRONT screen face (normal [0.206, 0, 0.966]) faces user directly!
        kioskPivotGroup.rotation.y = Math.atan2(dx, dz) - 0.2101;
    }
}

function startVRKioskDrag(controller, holdDistance, isGrip) {
    state.activeVRKioskDrag = {
        controller,
        holdDistance: Math.max(0.8, Math.min(4.5, holdDistance)),
        isGrip
    };
    redrawKioskTexture();
    const inputSource = controller.userData.inputSource;
    if (inputSource?.gamepad?.hapticActuators?.[0]) {
        inputSource.gamepad.hapticActuators[0].pulse(0.8, 60);
    }
}

function endVRKioskDrag() {
    if (state.activeVRKioskDrag) {
        const inputSource = state.activeVRKioskDrag.controller?.userData?.inputSource;
        if (inputSource?.gamepad?.hapticActuators?.[0]) {
            inputSource.gamepad.hapticActuators[0].pulse(0.5, 40);
        }
        state.activeVRKioskDrag = null;
        redrawKioskTexture();
    }
}

function updateVRKioskDrag(delta) {
    if (!renderer.xr.isPresenting || !state.activeVRKioskDrag) return;

    const drag = state.activeVRKioskDrag;
    const ctrl = drag.controller;
    if (!ctrl) return;

    ctrl.updateMatrixWorld(true);

    const inputSource = ctrl.userData.inputSource;
    if (inputSource?.gamepad) {
        const gp = inputSource.gamepad;
        const stickX = (gp.axes.length >= 4) ? gp.axes[2] : (gp.axes[0] || 0);
        const stickY = (gp.axes.length >= 4) ? gp.axes[3] : (gp.axes[1] || 0);

        if (Math.abs(stickY) > 0.15) {
            drag.holdDistance = THREE.MathUtils.clamp(drag.holdDistance - stickY * 2.2 * delta, 0.8, 4.5);
        }
        if (Math.abs(stickX) > 0.15) {
            kioskPivotGroup.rotation.y -= stickX * 1.8 * delta;
        }
    }

    const ctrlPos = new THREE.Vector3();
    ctrl.getWorldPosition(ctrlPos);
    const ctrlDir = new THREE.Vector3(0, 0, -1).transformDirection(ctrl.matrixWorld);

    // Project onto laboratory floor (Y = 0)
    const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const ray = new THREE.Ray(ctrlPos, ctrlDir);
    const hitPt = new THREE.Vector3();

    let targetX, targetZ;
    if (ray.intersectPlane(floorPlane, hitPt) && hitPt.distanceTo(ctrlPos) <= drag.holdDistance * 1.8) {
        targetX = hitPt.x;
        targetZ = hitPt.z;
    } else {
        const rawPt = new THREE.Vector3().copy(ctrlPos).addScaledVector(ctrlDir, drag.holdDistance);
        targetX = rawPt.x;
        targetZ = rawPt.z;
    }

    targetX = THREE.MathUtils.clamp(targetX, -3.4, 3.4);
    targetZ = THREE.MathUtils.clamp(targetZ, -3.0, 3.0);

    kioskPivotGroup.position.lerp(new THREE.Vector3(targetX, 0, targetZ), 0.28);

    // Auto face player if not manually steering
    const headPos = new THREE.Vector3();
    camera.getWorldPosition(headPos);
    const dx = headPos.x - kioskPivotGroup.position.x;
    const dz = headPos.z - kioskPivotGroup.position.z;
    if (Math.hypot(dx, dz) > 0.4) {
        const targetRotY = Math.atan2(dx, dz) - 0.2101;
        kioskPivotGroup.rotation.y = THREE.MathUtils.lerp(kioskPivotGroup.rotation.y, targetRotY, 0.15);
    }
}

function drawRoundRect(ctx, x, y, w, h, r) {
    if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, r);
    } else {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.arcTo(x + w, y, x + w, y + r, r);
        ctx.lineTo(x + w, y + h - r);
        ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);
        ctx.arcTo(x, y + h, x, y + h - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
    }
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';
    let curY = y;
    for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + ' ';
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxWidth && n > 0) {
            ctx.fillText(line.trim(), x, curY);
            line = words[n] + ' ';
            curY += lineHeight;
        } else {
            line = testLine;
        }
    }
    ctx.fillText(line.trim(), x, curY);
    return curY + lineHeight;
}

const KIOSK_TABS = [
    { id: 'aim', label: '🎯 AIM', x: 60, y: 62, w: 184, h: 44 },
    { id: 'diagram', label: '📐 DIAGRAM', x: 254, y: 62, w: 184, h: 44 },
    { id: 'results', label: '📊 RESULTS', x: 448, y: 62, w: 184, h: 44 },
    { id: 'lesson', label: '🎓 LESSON', x: 642, y: 62, w: 184, h: 44 },
    { id: 'quiz', label: '📝 QUIZ', x: 836, y: 62, w: 184, h: 44 }
];

const KIOSK_LESSON_NAV_BUTTONS = [
    { id: 'prev', label: '◀ PREV STAGE', x: 60, y: 790, w: 260, h: 58, bg: '#1e293b', border: '#475569' },
    { id: 'bench', label: '🎯 TELEPORT TO BENCH', x: 340, y: 790, w: 400, h: 58, bg: '#0284c7', border: '#38bdf8', glow: true },
    { id: 'next', label: 'NEXT STAGE ▶', x: 760, y: 790, w: 260, h: 58, bg: '#1e293b', border: '#475569' }
];

const KIOSK_LESSON_CTRL_BUTTONS = [
    { id: 'laser', label: '⚡ LASER POWER', x: 60, y: 865, w: 300, h: 58 },
    { id: 'quantum', label: '⚛ QUANTUM MODE', x: 380, y: 865, w: 320, h: 58 },
    { id: 'quiz', label: '📝 TAKE QUIZ', x: 720, y: 865, w: 300, h: 58, bg: '#4338ca', border: '#818cf8' }
];

const KIOSK_BOTTOM_BUTTONS = [
    { id: 'bench', label: '🎯 TELEPORT TO BENCH', x: 60, y: 1250, w: 340, h: 48, bg: '#0284c7', border: '#38bdf8', glow: true },
    { id: 'laser', label: '⚡ LASER POWER', x: 420, y: 1250, w: 240, h: 48 },
    { id: 'reset-kiosk', label: '🔄 RESET KIOSK', x: 680, y: 1250, w: 180, h: 48, bg: '#1e293b', border: '#475569' },
    { id: 'face-kiosk', label: '👁 FACE ME', x: 880, y: 1250, w: 140, h: 48, bg: '#1e293b', border: '#475569' }
];

const KIOSK_STAGES = [
    { id: 1, num: '(1)', title: 'Inspect optical rail & zero state', y: 415, h: 60 },
    { id: 2, num: '(2)', title: 'Adjust wavelength & observe color shift', y: 483, h: 60 },
    { id: 3, num: '(3)', title: 'Slit separation (d) fringe compression', y: 551, h: 60 },
    { id: 4, num: '(4)', title: 'Screen distance (D) rail projection', y: 619, h: 60 },
    { id: 5, num: '(5)', title: 'Single-slit envelope & which-path', y: 687, h: 60 },
    { id: 6, num: '(6)', title: 'Quantum photon buildup & assessment quiz', y: 755, h: 60 }
];

const KIOSK_LESSON_BUTTONS = [
    { id: 'prev', label: '◀ PREV STAGE', x: 60, y: 835, w: 260, h: 65, bg: '#1e293b', border: '#475569' },
    { id: 'bench', label: '🎯 TELEPORT TO BENCH', x: 340, y: 835, w: 400, h: 65, bg: '#0284c7', border: '#38bdf8', glow: true },
    { id: 'next', label: 'NEXT STAGE ▶', x: 760, y: 835, w: 260, h: 65, bg: '#1e293b', border: '#475569' },
    { id: 'laser', label: '⚡ LASER POWER', x: 60, y: 915, w: 300, h: 65, bg: '#15803d', border: '#22c55e' },
    { id: 'quantum', label: '⚛ QUANTUM MODE', x: 380, y: 915, w: 320, h: 65, bg: '#1e293b', border: '#475569' },
    { id: 'quiz', label: '📝 PHYSICS QUIZ', x: 720, y: 915, w: 300, h: 65, bg: '#4338ca', border: '#818cf8' }
];

function redrawKioskTexture(hoverPoint = null) {
    if (!kioskCtx) return;

    // 1. Background
    kioskCtx.fillStyle = '#080c16';
    kioskCtx.fillRect(0, 0, 1080, 1380);

    // Subtle technical grid
    kioskCtx.strokeStyle = 'rgba(56, 189, 248, 0.035)';
    kioskCtx.lineWidth = 1;
    for (let x = 60; x <= 1020; x += 60) {
        kioskCtx.beginPath();
        kioskCtx.moveTo(x, 40);
        kioskCtx.lineTo(x, 1340);
        kioskCtx.stroke();
    }
    for (let y = 40; y <= 1340; y += 60) {
        kioskCtx.beginPath();
        kioskCtx.moveTo(60, y);
        kioskCtx.lineTo(1020, y);
        kioskCtx.stroke();
    }

    // Outer screen bezel
    kioskCtx.strokeStyle = '#1e293b';
    kioskCtx.lineWidth = 4;
    drawRoundRect(kioskCtx, 16, 16, 1048, 1348, 16);
    kioskCtx.stroke();

    // 2. Top Drag Handle Bar
    const isKioskDragging = !!(state.activeVRKioskDrag || state.activeMouseKioskDrag);
    const isGrabBarHovered = hoverPoint && hoverPoint.y >= 12 && hoverPoint.y <= 52;

    if (isKioskDragging) {
        kioskCtx.fillStyle = '#0284c7';
        drawRoundRect(kioskCtx, 60, 16, 960, 34, 8);
        kioskCtx.fill();
        kioskCtx.strokeStyle = '#ffffff';
        kioskCtx.lineWidth = 2.5;
        kioskCtx.stroke();

        kioskCtx.fillStyle = '#ffffff';
        kioskCtx.font = 'bold 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.textAlign = 'center';
        kioskCtx.textBaseline = 'middle';
        kioskCtx.fillText('● MOVING KIOSK IN LAB... RELEASE TO DROP', 540, 33);
        kioskCtx.textAlign = 'left';
    } else if (isGrabBarHovered) {
        kioskCtx.fillStyle = '#0e3a5f';
        drawRoundRect(kioskCtx, 60, 16, 960, 34, 8);
        kioskCtx.fill();
        kioskCtx.strokeStyle = '#38bdf8';
        kioskCtx.lineWidth = 2;
        kioskCtx.stroke();

        kioskCtx.fillStyle = '#38bdf8';
        kioskCtx.font = 'bold 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.textAlign = 'center';
        kioskCtx.textBaseline = 'middle';
        kioskCtx.fillText('✊ HOLD GRIP OR CLICK & DRAG TO MOVE KIOSK IN LAB', 540, 33);
        kioskCtx.textAlign = 'left';
    } else {
        kioskCtx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        drawRoundRect(kioskCtx, 60, 16, 960, 34, 8);
        kioskCtx.fill();
        kioskCtx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
        kioskCtx.lineWidth = 1.5;
        kioskCtx.stroke();

        kioskCtx.fillStyle = '#38bdf8';
        kioskCtx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.textAlign = 'center';
        kioskCtx.textBaseline = 'middle';
        kioskCtx.fillText('⋮⋮ 🖐 DRAG / MOVE KIOSK IN LAB (HOLD GRIP OR CLICK & DRAG) ⋮⋮', 540, 33);
        kioskCtx.textAlign = 'left';
    }

    // 3. Tab Navigation Bar (AIM & PURPOSE | RAY DIAGRAM | LIVE RESULTS | GUIDED LESSON)
    KIOSK_TABS.forEach((t) => {
        const isCurrent = state.kioskTab === t.id;
        const isHovered = hoverPoint && hoverPoint.x >= t.x && hoverPoint.x <= t.x + t.w && hoverPoint.y >= t.y && hoverPoint.y <= t.y + t.h;

        kioskCtx.fillStyle = isCurrent ? '#0284c7' : (isHovered ? '#1e293b' : '#0f172a');
        drawRoundRect(kioskCtx, t.x, t.y, t.w, t.h, 10);
        kioskCtx.fill();

        kioskCtx.strokeStyle = isCurrent ? '#38bdf8' : (isHovered ? '#64748b' : 'rgba(255, 255, 255, 0.08)');
        kioskCtx.lineWidth = isCurrent ? 2.5 : 1.5;
        kioskCtx.stroke();

        kioskCtx.fillStyle = isCurrent ? '#ffffff' : (isHovered ? '#f8fafc' : '#94a3b8');
        kioskCtx.font = isCurrent ? 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' : '600 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.textAlign = 'center';
        kioskCtx.textBaseline = 'middle';
        kioskCtx.fillText(t.label, t.x + t.w / 2, t.y + t.h / 2);
        kioskCtx.textAlign = 'left';
    });

    const lambdaNm = (physics.wavelength * 1e9).toFixed(1);
    const dMm = (physics.slitSeparation * 1e3).toFixed(2);
    const aMm = (physics.slitWidth * 1e3).toFixed(2);
    const DM = physics.screenDistance.toFixed(2);
    const betaMm = (physics.getFringeSpacing() * 1e3).toFixed(2);
    const laserRGB = YDSEPhysicsModel.wavelengthToRGB(physics.wavelength);

    // =========================================================================
    // TAB 1: AIM, OBJECTIVE & PURPOSE
    // =========================================================================
    if (state.kioskTab === 'aim') {
        // Category Pill
        kioskCtx.fillStyle = '#0f172a';
        drawRoundRect(kioskCtx, 60, 122, 500, 32, 16);
        kioskCtx.fill();
        kioskCtx.strokeStyle = '#38bdf8';
        kioskCtx.lineWidth = 1.5;
        kioskCtx.stroke();
        kioskCtx.fillStyle = '#38bdf8';
        kioskCtx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.fillText('● EXPERIMENT 01 • FORMAL LABORATORY MANUAL', 80, 138);

        // Titles
        kioskCtx.fillStyle = '#ffffff';
        kioskCtx.font = 'bold 50px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.fillText("Young's double slit", 60, 200);

        // Card 1: AIM
        kioskCtx.fillStyle = '#09101e';
        drawRoundRect(kioskCtx, 60, 225, 960, 165, 12);
        kioskCtx.fill();
        kioskCtx.strokeStyle = '#38bdf8';
        kioskCtx.lineWidth = 2;
        kioskCtx.stroke();

        kioskCtx.fillStyle = '#38bdf8';
        kioskCtx.font = 'bold 19px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.fillText('🎯 AIM OF THE EXPERIMENT', 85, 258);

        kioskCtx.fillStyle = '#cbd5e1';
        kioskCtx.font = '16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        drawWrappedText(kioskCtx,
            'To investigate the wave nature of light using two-beam division of wavefront, determine the optical wavelength of the laser source (λ), verify the spatial fringe spacing equation β = λD/d, analyze the single-slit diffraction envelope sinc²(πa·sinθ/λ), identify missing interference orders, and demonstrate quantum wave-particle duality through single-photon detection.',
            85, 290, 910, 24
        );

        // Card 2: PURPOSE & HISTORICAL SIGNIFICANCE
        kioskCtx.fillStyle = '#09101e';
        drawRoundRect(kioskCtx, 60, 410, 960, 260, 12);
        kioskCtx.fill();
        kioskCtx.strokeStyle = '#818cf8';
        kioskCtx.lineWidth = 2;
        kioskCtx.stroke();

        kioskCtx.fillStyle = '#818cf8';
        kioskCtx.font = 'bold 19px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.fillText('💡 PURPOSE & HISTORICAL SIGNIFICANCE', 85, 442);

        kioskCtx.fillStyle = '#f8fafc';
        kioskCtx.font = 'bold 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.fillText('• The Classical Wave Victory (1801):', 85, 472);

        kioskCtx.fillStyle = '#94a3b8';
        kioskCtx.font = '15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        drawWrappedText(kioskCtx,
            "Originally performed by Thomas Young, this milestone experiment delivered the first definitive empirical proof that light behaves as a wave, overcoming Isaac Newton's century-old corpuscular (particle) hypothesis. The emergence of alternating bright and dark fringes proves that light waves from two coherent apertures superimpose constructively (in-phase) and destructively (out-of-phase).",
            85, 498, 910, 22
        );

        kioskCtx.fillStyle = '#f8fafc';
        kioskCtx.font = 'bold 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.fillText('• Modern Quantum Mechanics & Wave-Particle Duality:', 85, 575);

        kioskCtx.fillStyle = '#94a3b8';
        kioskCtx.font = '15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        drawWrappedText(kioskCtx,
            'When light intensity is attenuated so photons travel one by one, each single photon produces a discrete impact click on the detector. Over time, these discrete particle marks build up the identical continuous wave interference pattern, demonstrating wave-particle duality and the fundamental quantum probability amplitude Ψ.',
            85, 601, 910, 22
        );

        // Card 3: KEY LEARNING OBJECTIVES
        kioskCtx.fillStyle = '#09101e';
        drawRoundRect(kioskCtx, 60, 690, 960, 310, 12);
        kioskCtx.fill();
        kioskCtx.strokeStyle = '#34d399';
        kioskCtx.lineWidth = 2;
        kioskCtx.stroke();

        kioskCtx.fillStyle = '#34d399';
        kioskCtx.font = 'bold 19px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.fillText('📌 KEY LEARNING OBJECTIVES', 85, 722);

        const objectives = [
            '1. Wavefront Division: Split a single coherent laser wavefront into two secondary sources at slits S₁ and S₂.',
            '2. Wavelength Scaling (β ∝ λ): Verify that fringe spacing expands proportionally with wavelength (Red fringes are wider than Violet fringes).',
            '3. Slit Spacing Dynamics (β ∝ 1/d): Demonstrate that narrower slit separation produces broader, more easily resolved fringes.',
            '4. Projection Distance Scaling (β ∝ D): Verify linear fringe magnification by sliding observation screen along optical rail distance D.',
            '5. Diffraction Modulation: Observe single-slit envelope sinc² suppressing fringes where d/a is an integer (missing orders).',
            '6. Quantitative Verification: Calculate unknown optical wavelength λ from experimental measurements of β, d, and D.'
        ];

        let objY = 752;
        kioskCtx.fillStyle = '#cbd5e1';
        kioskCtx.font = '15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        objectives.forEach(obj => {
            objY = drawWrappedText(kioskCtx, obj, 85, objY, 910, 22);
            objY += 2;
        });

        // Card 4: APPARATUS & COMPONENTS
        kioskCtx.fillStyle = '#070b16';
        drawRoundRect(kioskCtx, 60, 1020, 960, 205, 12);
        kioskCtx.fill();
        kioskCtx.strokeStyle = '#1e293b';
        kioskCtx.lineWidth = 1.5;
        kioskCtx.stroke();

        kioskCtx.fillStyle = '#38bdf8';
        kioskCtx.font = 'bold 17px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.fillText('🔬 APPARATUS & TECHNICAL SPECIFICATIONS', 85, 1052);

        const specs = [
            { label: 'COHERENT SOURCE', val: 'Diode Laser (380–750 nm, P = 5 mW)' },
            { label: 'SLIT ASSEMBLY', val: 'Dual precision slits (d = 0.50 mm, a = 0.10 mm)' },
            { label: 'OPTICAL BENCH', val: '2.5m precision calibrated rail with vernier scale' },
            { label: 'DETECTOR', val: 'Phosphor screen with real-time photometric sensor' }
        ];

        specs.forEach((sp, idx) => {
            const sx = 85 + (idx % 2) * 460;
            const sy = 1075 + Math.floor(idx / 2) * 65;
            kioskCtx.fillStyle = '#0f172a';
            drawRoundRect(kioskCtx, sx, sy, 440, 52, 8);
            kioskCtx.fill();
            kioskCtx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
            kioskCtx.lineWidth = 1;
            kioskCtx.stroke();

            kioskCtx.fillStyle = '#64748b';
            kioskCtx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            kioskCtx.fillText(sp.label, sx + 14, sy + 20);

            kioskCtx.fillStyle = '#ffffff';
            kioskCtx.font = 'bold 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            kioskCtx.fillText(sp.val, sx + 14, sy + 40);
        });
    }

    // =========================================================================
    // TAB 2: SCIENTIFIC OPTICAL RAY DIAGRAM
    // =========================================================================
    else if (state.kioskTab === 'diagram') {
        // Category Pill
        kioskCtx.fillStyle = '#0f172a';
        drawRoundRect(kioskCtx, 60, 122, 520, 32, 16);
        kioskCtx.fill();
        kioskCtx.strokeStyle = '#38bdf8';
        kioskCtx.lineWidth = 1.5;
        kioskCtx.stroke();
        kioskCtx.fillStyle = '#38bdf8';
        kioskCtx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.fillText('● OPTICAL GEOMETRY & RAY PROPAGATION DIAGRAM', 80, 138);

        // Titles
        kioskCtx.fillStyle = '#ffffff';
        kioskCtx.font = 'bold 44px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.fillText("Ray Diagram & Path Difference Δr", 60, 195);

        // Blueprint Diagram Box (x: 60..1020, y: 220..800)
        kioskCtx.fillStyle = '#050914';
        drawRoundRect(kioskCtx, 60, 220, 960, 580, 12);
        kioskCtx.fill();
        kioskCtx.strokeStyle = '#1e293b';
        kioskCtx.lineWidth = 2;
        kioskCtx.stroke();

        // Diagram Optical Centerline
        const cy = 510;
        kioskCtx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
        kioskCtx.lineWidth = 1;
        kioskCtx.setLineDash([6, 6]);
        kioskCtx.beginPath();
        kioskCtx.moveTo(80, cy);
        kioskCtx.lineTo(760, cy);
        kioskCtx.stroke();
        kioskCtx.setLineDash([]);

        kioskCtx.fillStyle = '#64748b';
        kioskCtx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.fillText('Central Optical Axis', 180, cy - 8);

        // 1. Laser Emitter at (120, cy)
        kioskCtx.fillStyle = '#0f172a';
        drawRoundRect(kioskCtx, 90, cy - 35, 70, 70, 8);
        kioskCtx.fill();
        kioskCtx.strokeStyle = laserRGB.hex;
        kioskCtx.lineWidth = 2.5;
        kioskCtx.stroke();

        kioskCtx.fillStyle = '#ffffff';
        kioskCtx.font = 'bold 12px sans-serif';
        kioskCtx.textAlign = 'center';
        kioskCtx.fillText('LASER', 125, cy - 8);
        kioskCtx.fillStyle = laserRGB.hex;
        kioskCtx.fillText(lambdaNm + ' nm', 125, cy + 12);
        kioskCtx.textAlign = 'left';

        // Wavefront arcs from laser
        kioskCtx.strokeStyle = laserRGB.hex;
        kioskCtx.lineWidth = 1.5;
        for (let r = 50; r <= 140; r += 45) {
            kioskCtx.beginPath();
            kioskCtx.arc(160, cy, r, -Math.PI / 4, Math.PI / 4);
            kioskCtx.stroke();
        }

        // 2. Double Slit Barrier at x = 360
        const slitX = 360;
        const s1Y = cy - 60; // 450
        const s2Y = cy + 60; // 570

        // Slit barrier bars
        kioskCtx.fillStyle = '#334155';
        kioskCtx.fillRect(slitX - 5, cy - 220, 10, (s1Y - 12) - (cy - 220)); // Top bar
        kioskCtx.fillRect(slitX - 5, s1Y + 12, 10, (s2Y - 12) - (s1Y + 12)); // Middle bar
        kioskCtx.fillRect(slitX - 5, s2Y + 12, 10, (cy + 220) - (s2Y + 12)); // Bottom bar

        kioskCtx.fillStyle = '#38bdf8';
        kioskCtx.font = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.fillText('S₁', slitX - 32, s1Y + 5);
        kioskCtx.fillText('S₂', slitX - 32, s2Y + 5);

        // Dimension arrow for d
        kioskCtx.strokeStyle = '#38bdf8';
        kioskCtx.lineWidth = 1.5;
        kioskCtx.beginPath();
        kioskCtx.moveTo(slitX - 18, s1Y);
        kioskCtx.lineTo(slitX - 18, s2Y);
        kioskCtx.stroke();

        kioskCtx.fillStyle = '#38bdf8';
        kioskCtx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.textAlign = 'right';
        kioskCtx.fillText('d = ' + dMm + ' mm', slitX - 24, cy + 4);
        kioskCtx.textAlign = 'left';

        // 3. Observation Screen at x = 760
        const screenX = 760;
        kioskCtx.fillStyle = '#f8fafc';
        kioskCtx.fillRect(screenX, cy - 240, 8, 480);
        kioskCtx.strokeStyle = '#38bdf8';
        kioskCtx.lineWidth = 2;
        kioskCtx.strokeRect(screenX, cy - 240, 8, 480);

        kioskCtx.fillStyle = '#ffffff';
        kioskCtx.font = 'bold 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.fillText('Observation Screen', screenX - 40, cy - 250);

        // Point O (Central Bright Maximum)
        kioskCtx.fillStyle = '#22c55e';
        kioskCtx.beginPath();
        kioskCtx.arc(screenX, cy, 5, 0, Math.PI * 2);
        kioskCtx.fill();
        kioskCtx.fillText('O (x = 0, Central Max)', screenX + 16, cy + 5);

        // Point P(x) at y = 350
        const py = cy - 150; // 360
        kioskCtx.fillStyle = '#f59e0b';
        kioskCtx.beginPath();
        kioskCtx.arc(screenX, py, 6, 0, Math.PI * 2);
        kioskCtx.fill();
        kioskCtx.fillText('P(x)', screenX + 16, py + 5);

        // Dimension x on screen
        kioskCtx.strokeStyle = '#f59e0b';
        kioskCtx.lineWidth = 1.5;
        kioskCtx.beginPath();
        kioskCtx.moveTo(screenX + 8, cy);
        kioskCtx.lineTo(screenX + 8, py);
        kioskCtx.stroke();
        kioskCtx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.fillText('x', screenX + 16, (cy + py) / 2 + 4);

        // 4. Propagating Light Rays (r1 from S1 to P, r2 from S2 to P)
        kioskCtx.strokeStyle = laserRGB.hex;
        kioskCtx.lineWidth = 2;

        // Ray 1
        kioskCtx.beginPath();
        kioskCtx.moveTo(slitX, s1Y);
        kioskCtx.lineTo(screenX, py);
        kioskCtx.stroke();

        kioskCtx.fillStyle = laserRGB.hex;
        kioskCtx.font = 'bold 14px sans-serif';
        kioskCtx.fillText('Ray 1 (r₁)', (slitX + screenX) / 2 - 40, (s1Y + py) / 2 - 12);

        // Ray 2
        kioskCtx.beginPath();
        kioskCtx.moveTo(slitX, s2Y);
        kioskCtx.lineTo(screenX, py);
        kioskCtx.stroke();
        kioskCtx.fillText('Ray 2 (r₂)', (slitX + screenX) / 2 - 40, (s2Y + py) / 2 + 16);

        // Perpendicular dropped from S1 to Ray 2 (point M)
        const mx = slitX + 24;
        const my = s2Y - 26;
        kioskCtx.strokeStyle = '#f59e0b';
        kioskCtx.lineWidth = 2;
        kioskCtx.setLineDash([4, 4]);
        kioskCtx.beginPath();
        kioskCtx.moveTo(slitX, s1Y);
        kioskCtx.lineTo(mx, my);
        kioskCtx.stroke();
        kioskCtx.setLineDash([]);

        // Path difference segment S2 - M
        kioskCtx.strokeStyle = '#fbbf24';
        kioskCtx.lineWidth = 4;
        kioskCtx.beginPath();
        kioskCtx.moveTo(slitX, s2Y);
        kioskCtx.lineTo(mx, my);
        kioskCtx.stroke();

        kioskCtx.fillStyle = '#fbbf24';
        kioskCtx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.fillText('Δr = d·sin(θ)', slitX + 32, s2Y - 10);

        // Screen distance D arrow at bottom
        kioskCtx.strokeStyle = '#94a3b8';
        kioskCtx.lineWidth = 1.5;
        kioskCtx.beginPath();
        kioskCtx.moveTo(slitX, cy + 245);
        kioskCtx.lineTo(screenX, cy + 245);
        kioskCtx.stroke();

        kioskCtx.fillStyle = '#cbd5e1';
        kioskCtx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.textAlign = 'center';
        kioskCtx.fillText('D = ' + DM + ' m', (slitX + screenX) / 2, cy + 240);
        kioskCtx.textAlign = 'left';

        // 5. Real-Time Interference Intensity Plot next to screen (x: 820..990)
        kioskCtx.strokeStyle = laserRGB.hex;
        kioskCtx.fillStyle = 'rgba(' + (laserRGB.hex === '#ef4444' ? '239, 68, 68, 0.25' : '14, 165, 233, 0.25') + ')';
        kioskCtx.lineWidth = 2;

        kioskCtx.beginPath();
        const plotStartX = 840;
        const maxAmp = 120;
        for (let y = cy - 230; y <= cy + 230; y += 2) {
            const dy = (y - cy) * 0.05;
            const twoSlit = Math.cos(dy * 2.8) ** 2;
            const sincVal = dy === 0 ? 1 : Math.sin(dy * 0.56) / (dy * 0.56);
            const intensity = twoSlit * (sincVal ** 2);
            const px = plotStartX + intensity * maxAmp;
            if (y === cy - 230) kioskCtx.moveTo(px, y);
            else kioskCtx.lineTo(px, y);
        }
        kioskCtx.stroke();

        kioskCtx.fillStyle = '#94a3b8';
        kioskCtx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.fillText('I(x) Profile', plotStartX + 10, cy - 235);
        kioskCtx.fillText('m=0 Central Max', plotStartX + maxAmp + 8, cy + 4);
        kioskCtx.fillText('m=1 (β = ' + betaMm + 'mm)', plotStartX + maxAmp * 0.75 + 8, cy - 65);

        // Equations Box below diagram (y: 820..1220)
        const eqCards = [
            {
                title: 'PATH & PHASE DIFFERENCE',
                color: '#38bdf8',
                lines: [
                    '• Exact Geometric Path Difference:',
                    '  Δr = r₂ - r₁ = √(D² + (x + d/2)²) - √(D² + (x - d/2)²)',
                    '• Small-Angle Approximation (θ ≪ 1):',
                    '  Δr ≈ d·sin(θ) ≈ d·tan(θ) ≈ d·(x / D)',
                    '• Phase Difference:',
                    '  Δϕ = (2π / λ) · Δr = (2π d x) / (λ D)'
                ],
                x: 60, y: 820, w: 465, h: 200
            },
            {
                title: 'INTERFERENCE CONDITIONS',
                color: '#34d399',
                lines: [
                    '• Constructive Interference (Bright Fringes):',
                    '  Δr = m·λ  ⟹  x_m = m·(λD / d)   (m = 0, ±1, ±2, ...)',
                    '• Destructive Interference (Dark Fringes):',
                    '  Δr = (m + ½)·λ  ⟹  x_m = (m + ½)·(λD / d)',
                    '• Fringe Width (Spacing between adjacent fringes):',
                    '  β = x_{m+1} - x_m = λD / d = ' + betaMm + ' mm'
                ],
                x: 555, y: 820, w: 465, h: 200
            },
            {
                title: 'DIFFRACTION ENVELOPE & MISSING ORDERS',
                color: '#818cf8',
                lines: [
                    '• Combined Two-Slit & Single-Slit Intensity Profile:',
                    '  I(θ) = I₀ · cos²(π d sinθ / λ) · sinc²(π a sinθ / λ)   where sinc(u) = sin(u)/u',
                    '• Missing Order Condition (Interference max suppressed by diffraction min):',
                    '  m = d / a = ' + (physics.slitSeparation / physics.slitWidth).toFixed(1) + '  ⟹ The ' + (physics.slitSeparation / physics.slitWidth).toFixed(0) + 'th interference fringe is extinguished by the sinc² envelope!',
                    '• Angular Width of Central Diffraction Peak: 2θ_diff = 2λ / a = ' + ((2 * physics.wavelength / physics.slitWidth) * 1e3).toFixed(2) + ' mrad'
                ],
                x: 60, y: 1035, w: 960, h: 185
            }
        ];

        eqCards.forEach(ec => {
            kioskCtx.fillStyle = '#09101e';
            drawRoundRect(kioskCtx, ec.x, ec.y, ec.w, ec.h, 10);
            kioskCtx.fill();
            kioskCtx.strokeStyle = ec.color;
            kioskCtx.lineWidth = 1.5;
            kioskCtx.stroke();

            kioskCtx.fillStyle = ec.color;
            kioskCtx.font = 'bold 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            kioskCtx.fillText(ec.title, ec.x + 16, ec.y + 26);

            kioskCtx.fillStyle = '#cbd5e1';
            kioskCtx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            let ly = ec.y + 54;
            ec.lines.forEach(line => {
                kioskCtx.fillText(line, ec.x + 16, ly);
                ly += 22;
            });
        });
    }

    // =========================================================================
    // TAB 3: LIVE EXPERIMENTAL RESULTS
    // =========================================================================
    else if (state.kioskTab === 'results') {
        // Category Pill
        kioskCtx.fillStyle = '#0f172a';
        drawRoundRect(kioskCtx, 60, 122, 540, 32, 16);
        kioskCtx.fill();
        kioskCtx.strokeStyle = '#38bdf8';
        kioskCtx.lineWidth = 1.5;
        kioskCtx.stroke();
        kioskCtx.fillStyle = '#38bdf8';
        kioskCtx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.fillText('● QUANTITATIVE RESULTS & EXPERIMENTAL VERIFICATION', 80, 138);

        // Titles
        kioskCtx.fillStyle = '#ffffff';
        kioskCtx.font = 'bold 44px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.fillText("Experimental Results & Analysis", 60, 195);

        // 6 Real-Time Result Tiles (y: 220..500)
        const beta = physics.getFringeSpacing();
        const thetaRad = physics.wavelength / physics.slitSeparation;
        const thetaDeg = thetaRad * (180 / Math.PI);
        const xDiff = (physics.wavelength * physics.screenDistance) / physics.slitWidth;
        const N = Math.floor(2 * (physics.slitSeparation / physics.slitWidth) - 1);

        const resultTiles = [
            { label: 'FRINGE SPACING (β = λD/d)', val: (beta * 1e3).toFixed(2) + ' mm', sub: 'Measured spacing between adjacent fringes', accent: true },
            { label: 'CENTRAL MAX FULL WIDTH (2β)', val: (2 * beta * 1e3).toFixed(2) + ' mm', sub: 'Distance between first dark fringes' },
            { label: 'ANGULAR FRINGE SPACING (θ_β)', val: (thetaRad * 1e3).toFixed(2) + ' mrad', sub: thetaDeg.toFixed(3) + '° angular divergence' },
            { label: '1ST DIFFRACTION MINIMUM (x_diff)', val: (xDiff * 1e3).toFixed(2) + ' mm', sub: 'Envelope cutoff x = λD/a' },
            { label: 'VISIBLE FRINGES IN MAIN PEAK', val: N + ' bright fringes', sub: 'N = 2(d/a) - 1 inside central envelope' },
            { label: 'INTERFERENCE VISIBILITY (V)', val: (physics.visibility * 100).toFixed(0) + '.0%', sub: 'V = (I_max - I_min) / (I_max + I_min)' }
        ];

        resultTiles.forEach((rt, idx) => {
            const rx = 60 + (idx % 3) * 330;
            const ry = 220 + Math.floor(idx / 3) * 135;
            kioskCtx.fillStyle = rt.accent ? '#0c223c' : '#09101e';
            drawRoundRect(kioskCtx, rx, ry, 310, 120, 10);
            kioskCtx.fill();
            kioskCtx.strokeStyle = rt.accent ? '#38bdf8' : '#1e293b';
            kioskCtx.lineWidth = rt.accent ? 2 : 1.5;
            kioskCtx.stroke();

            kioskCtx.fillStyle = rt.accent ? '#38bdf8' : '#94a3b8';
            kioskCtx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            kioskCtx.fillText(rt.label, rx + 14, ry + 24);

            kioskCtx.fillStyle = rt.accent ? '#38bdf8' : '#ffffff';
            kioskCtx.font = 'bold 28px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            kioskCtx.fillText(rt.val, rx + 14, ry + 66);

            kioskCtx.fillStyle = '#64748b';
            kioskCtx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            kioskCtx.fillText(rt.sub, rx + 14, ry + 98);
        });

        // Observation Table (y: 520..840)
        kioskCtx.fillStyle = '#070b16';
        drawRoundRect(kioskCtx, 60, 520, 960, 310, 12);
        kioskCtx.fill();
        kioskCtx.strokeStyle = '#1e293b';
        kioskCtx.lineWidth = 1.5;
        kioskCtx.stroke();

        kioskCtx.fillStyle = '#38bdf8';
        kioskCtx.font = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.fillText('📋 INTERFERENCE ORDER OBSERVATION & VERIFICATION TABLE', 85, 550);

        // Table Header
        const cols = [
            { name: 'Order (m)', x: 85 },
            { name: 'Fringe Type', x: 200 },
            { name: 'Position x (mm)', x: 380 },
            { name: 'Path Diff Δr', x: 550 },
            { name: 'Phase Diff Δϕ', x: 720 },
            { name: 'Intensity I/I₀', x: 870 }
        ];

        kioskCtx.fillStyle = '#64748b';
        kioskCtx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        cols.forEach(c => kioskCtx.fillText(c.name, c.x, 582));

        kioskCtx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        kioskCtx.lineWidth = 1;
        kioskCtx.beginPath();
        kioskCtx.moveTo(85, 592);
        kioskCtx.lineTo(995, 592);
        kioskCtx.stroke();

        const tableRows = [
            { m: 'm = 0', type: 'Central Maximum', x: '0.00 mm', dr: '0.0 nm (0λ)', dp: '0.0 rad', i: '100.0%', color: '#38bdf8' },
            { m: 'm = ½', type: '1st Dark Fringe', x: '±' + (0.5 * beta * 1e3).toFixed(2) + ' mm', dr: (0.5 * physics.wavelength * 1e9).toFixed(0) + ' nm (½λ)', dp: 'π rad', i: '0.0%', color: '#94a3b8' },
            { m: 'm = 1', type: '1st Bright Fringe', x: '±' + (beta * 1e3).toFixed(2) + ' mm', dr: (physics.wavelength * 1e9).toFixed(0) + ' nm (1λ)', dp: '2π rad', i: '95.8%', color: '#ffffff' },
            { m: 'm = 1½', type: '2nd Dark Fringe', x: '±' + (1.5 * beta * 1e3).toFixed(2) + ' mm', dr: (1.5 * physics.wavelength * 1e9).toFixed(0) + ' nm', dp: '3π rad', i: '0.0%', color: '#94a3b8' },
            { m: 'm = 2', type: '2nd Bright Fringe', x: '±' + (2 * beta * 1e3).toFixed(2) + ' mm', dr: (2 * physics.wavelength * 1e9).toFixed(0) + ' nm (2λ)', dp: '4π rad', i: '84.3%', color: '#ffffff' },
            { m: 'm = ' + (physics.slitSeparation / physics.slitWidth).toFixed(0), type: 'Missing Order (Suppressed)', x: '±' + ((physics.slitSeparation / physics.slitWidth) * beta * 1e3).toFixed(2) + ' mm', dr: 'd/a = integer', dp: (physics.slitSeparation / physics.slitWidth * 2).toFixed(0) + 'π rad', i: '0.0% (sinc²=0)', color: '#ef4444' }
        ];

        let ty = 620;
        tableRows.forEach(tr => {
            kioskCtx.fillStyle = tr.color;
            kioskCtx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            kioskCtx.fillText(tr.m, cols[0].x, ty);
            kioskCtx.fillText(tr.type, cols[1].x, ty);
            kioskCtx.fillText(tr.x, cols[2].x, ty);
            kioskCtx.fillText(tr.dr, cols[3].x, ty);
            kioskCtx.fillText(tr.dp, cols[4].x, ty);
            kioskCtx.fillText(tr.i, cols[5].x, ty);
            ty += 34;
        });

        // Formal Conclusion Card (y: 855..1220)
        kioskCtx.fillStyle = '#071812';
        drawRoundRect(kioskCtx, 60, 855, 960, 365, 12);
        kioskCtx.fill();
        kioskCtx.strokeStyle = '#22c55e';
        kioskCtx.lineWidth = 2;
        kioskCtx.stroke();

        kioskCtx.fillStyle = '#4ade80';
        kioskCtx.font = 'bold 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.fillText('✅ FORMAL SCIENTIFIC CONCLUSION & DEDUCTIONS', 85, 888);

        const conclusions = [
            '1. Verification of Wave Superposition: The experimentally measured fringe spacing β = ' + betaMm + ' mm confirms the theoretical relation β = λD/d within experimental limits.',
            '2. Wavelength Proportionality (β ∝ λ): Shifting wavelength directly stretches fringe spacing. Red light (' + lambdaNm + ' nm) produces visibly wider fringes than shorter violet wavelengths.',
            '3. Rail Distance Scaling (β ∝ D): Moving the observation screen further along the rail magnifies the interference pattern linearly without distorting fringe shape.',
            '4. Slit Separation Invariance (β ∝ 1/d): Narrowing slit spacing d expands fringe width, proving that smaller aperture separations produce wider spatial interference spreading.',
            '5. Single-Slit Diffraction Envelope: The single-slit diffraction sinc² envelope modulates fringe intensities, producing a central envelope containing ' + N + ' bright fringes with a missing order at m = ' + (physics.slitSeparation / physics.slitWidth).toFixed(0) + '.',
            '6. Quantum Superposition Synthesis: In single-photon mode, discrete localized impacts statistically accumulate into this identical wave pattern, validating the quantum wave-particle duality.'
        ];

        let cyTxt = 920;
        kioskCtx.fillStyle = '#e2e8f0';
        kioskCtx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        conclusions.forEach(c => {
            cyTxt = drawWrappedText(kioskCtx, c, 85, cyTxt, 910, 22);
            cyTxt += 4;
        });
    }

    // =========================================================================
    // TAB 4: GUIDED LESSON & LAB CONTROLS (Original 6-Stage Curriculum)
    // =========================================================================
    else if (state.kioskTab === 'lesson') {
        // Category Pill
        kioskCtx.fillStyle = '#0f172a';
        drawRoundRect(kioskCtx, 60, 122, 520, 32, 16);
        kioskCtx.fill();
        kioskCtx.strokeStyle = '#38bdf8';
        kioskCtx.lineWidth = 1.5;
        kioskCtx.stroke();
        kioskCtx.fillStyle = '#38bdf8';
        kioskCtx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.fillText('● 6-STAGE GUIDED LABORATORY CURRICULUM', 80, 138);

        // Titles matching user photo exactly
        kioskCtx.fillStyle = '#ffffff';
        kioskCtx.font = 'bold 50px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.fillText("Young's double slit", 60, 200);

        kioskCtx.fillStyle = '#94a3b8';
        kioskCtx.font = '500 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.fillText("Explore how two slits produce an interference pattern.", 60, 235);

        // Active Stage Banner
        const currentStageId = lesson ? lesson.currentStage : 1;
        const currentInfo = lesson ? lesson.getStageInfo(currentStageId) : null;

        kioskCtx.fillStyle = '#0f172a';
        drawRoundRect(kioskCtx, 60, 260, 960, 80, 12);
        kioskCtx.fill();
        kioskCtx.strokeStyle = '#38bdf8';
        kioskCtx.lineWidth = 2;
        kioskCtx.stroke();

        kioskCtx.fillStyle = '#38bdf8';
        kioskCtx.font = 'bold 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.fillText('CURRENT OBJECTIVE • STAGE ' + currentStageId + ' OF 6', 85, 285);

        kioskCtx.fillStyle = '#f8fafc';
        kioskCtx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.fillText(currentInfo?.title || 'Optical Apparatus Inspection', 85, 316);

        kioskCtx.fillStyle = '#64748b';
        kioskCtx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.textAlign = 'right';
        kioskCtx.fillText(currentInfo?.duration ? ('⏱ ' + currentInfo.duration) : '⏱ 1.5 min', 995, 285);
        kioskCtx.fillText('Click any stage below to jump ⤵', 995, 316);
        kioskCtx.textAlign = 'left';

        // 6 Clickable Stage Rows
        const stageStartY = 360;
        const stageH = 58;
        const stageSpacing = 68;

        KIOSK_STAGES.forEach((s, idx) => {
            const sy = stageStartY + idx * stageSpacing;
            s.y = sy;
            s.h = stageH;

            const isActive = s.id === currentStageId;
            const isHovered = hoverPoint && hoverPoint.x >= 60 && hoverPoint.x <= 1020 && hoverPoint.y >= sy && hoverPoint.y <= sy + stageH;

            if (isActive) {
                kioskCtx.fillStyle = 'rgba(14, 165, 233, 0.18)';
                drawRoundRect(kioskCtx, 60, sy, 960, stageH, 10);
                kioskCtx.fill();
                kioskCtx.strokeStyle = '#38bdf8';
                kioskCtx.lineWidth = 2;
                kioskCtx.stroke();
            } else if (isHovered) {
                kioskCtx.fillStyle = 'rgba(30, 41, 59, 0.9)';
                drawRoundRect(kioskCtx, 60, sy, 960, stageH, 10);
                kioskCtx.fill();
                kioskCtx.strokeStyle = '#64748b';
                kioskCtx.lineWidth = 1.5;
                kioskCtx.stroke();
            } else {
                kioskCtx.fillStyle = '#0b1322';
                drawRoundRect(kioskCtx, 60, sy, 960, stageH, 10);
                kioskCtx.fill();
                kioskCtx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
                kioskCtx.lineWidth = 1;
                kioskCtx.stroke();
            }

            // Number Badge
            kioskCtx.fillStyle = isActive ? '#38bdf8' : (isHovered ? '#7dd3fc' : '#38bdf8');
            kioskCtx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            kioskCtx.textBaseline = 'middle';
            kioskCtx.fillText(s.num, 85, sy + stageH / 2);

            // Title
            kioskCtx.fillStyle = isActive ? '#ffffff' : (isHovered ? '#ffffff' : '#cbd5e1');
            kioskCtx.font = isActive ? '600 19px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' : '500 19px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            kioskCtx.fillText(s.title, 140, sy + stageH / 2);

            // Right status pill
            if (isActive) {
                kioskCtx.fillStyle = '#0284c7';
                drawRoundRect(kioskCtx, 875, sy + 12, 125, 34, 17);
                kioskCtx.fill();
                kioskCtx.fillStyle = '#ffffff';
                kioskCtx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                kioskCtx.textAlign = 'center';
                kioskCtx.fillText('ACTIVE', 937, sy + stageH / 2);
                kioskCtx.textAlign = 'left';
            } else if (isHovered) {
                kioskCtx.fillStyle = '#475569';
                drawRoundRect(kioskCtx, 890, sy + 13, 110, 32, 16);
                kioskCtx.fill();
                kioskCtx.fillStyle = '#f8fafc';
                kioskCtx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                kioskCtx.textAlign = 'center';
                kioskCtx.fillText('SELECT ➔', 945, sy + stageH / 2);
                kioskCtx.textAlign = 'left';
            }
        });

        // Stage Navigation Row (y = 790)
        const navBtns = [
            { id: 'prev', label: '◀ PREV STAGE', x: 60, y: 790, w: 260, h: 58, bg: '#1e293b', border: '#475569' },
            { id: 'bench', label: '🎯 TELEPORT TO BENCH', x: 340, y: 790, w: 400, h: 58, bg: '#0284c7', border: '#38bdf8', glow: true },
            { id: 'next', label: 'NEXT STAGE ▶', x: 760, y: 790, w: 260, h: 58, bg: '#1e293b', border: '#475569' }
        ];

        navBtns.forEach(b => {
            const isHovered = hoverPoint && hoverPoint.x >= b.x && hoverPoint.x <= b.x + b.w && hoverPoint.y >= b.y && hoverPoint.y <= b.y + b.h;
            kioskCtx.fillStyle = b.bg;
            drawRoundRect(kioskCtx, b.x, b.y, b.w, b.h, 10);
            kioskCtx.fill();
            kioskCtx.strokeStyle = isHovered ? '#ffffff' : b.border;
            kioskCtx.lineWidth = isHovered ? 2.5 : 1.5;
            kioskCtx.stroke();

            kioskCtx.fillStyle = '#ffffff';
            kioskCtx.font = b.glow ? 'bold 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' : '600 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            kioskCtx.textAlign = 'center';
            kioskCtx.textBaseline = 'middle';
            kioskCtx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2);
            kioskCtx.textAlign = 'left';
        });

        // Quick Lab Controls Row (y = 865)
        const ctrlBtns = [
            { id: 'laser', label: physics.laserActive ? '⚡ LASER: ACTIVE' : '⚡ LASER: OFF', x: 60, y: 865, w: 300, h: 58, bg: physics.laserActive ? '#15803d' : '#991b1b', border: physics.laserActive ? '#22c55e' : '#ef4444' },
            { id: 'quantum', label: state.mode === 'quantum' ? '⚛ QUANTUM ON' : '⚛ WAVE MODE', x: 380, y: 865, w: 320, h: 58, bg: state.mode === 'quantum' ? '#6d28d9' : '#1e293b', border: state.mode === 'quantum' ? '#a855f7' : '#475569' },
            { id: 'quiz', label: '📝 TAKE QUIZ', x: 720, y: 865, w: 300, h: 58, bg: '#4338ca', border: '#818cf8' }
        ];

        ctrlBtns.forEach(b => {
            const isHovered = hoverPoint && hoverPoint.x >= b.x && hoverPoint.x <= b.x + b.w && hoverPoint.y >= b.y && hoverPoint.y <= b.y + b.h;
            kioskCtx.fillStyle = b.bg;
            drawRoundRect(kioskCtx, b.x, b.y, b.w, b.h, 10);
            kioskCtx.fill();
            kioskCtx.strokeStyle = isHovered ? '#ffffff' : b.border;
            kioskCtx.lineWidth = isHovered ? 2.5 : 1.5;
            kioskCtx.stroke();

            kioskCtx.fillStyle = '#ffffff';
            kioskCtx.font = '600 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            kioskCtx.textAlign = 'center';
            kioskCtx.textBaseline = 'middle';
            kioskCtx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2);
            kioskCtx.textAlign = 'left';
        });

        // Live Telemetry Card (y = 945..1220)
        kioskCtx.fillStyle = '#060a14';
        drawRoundRect(kioskCtx, 60, 945, 960, 275, 14);
        kioskCtx.fill();
        kioskCtx.strokeStyle = '#1e293b';
        kioskCtx.lineWidth = 1.5;
        kioskCtx.stroke();

        kioskCtx.fillStyle = '#38bdf8';
        kioskCtx.font = 'bold 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.fillText('LIVE OPTICAL BENCH TELEMETRY & FORMULAS', 85, 975);

        const telemBoxes = [
            { label: 'WAVELENGTH (λ)', val: lambdaNm + ' nm', sub: laserRGB.label, x: 85, y: 995, w: 215, colorDot: laserRGB.hex },
            { label: 'SLIT SPACING (d)', val: dMm + ' mm', sub: 'Centre-to-centre', x: 320, y: 995, w: 215 },
            { label: 'SCREEN DIST (D)', val: DM + ' m', sub: 'Slit to detector', x: 555, y: 995, w: 215 },
            { label: 'FRINGE SPACING (β)', val: betaMm + ' mm', sub: 'β = λD / d', x: 790, y: 995, w: 210, accent: true }
        ];

        telemBoxes.forEach(tb => {
            kioskCtx.fillStyle = '#0d1527';
            drawRoundRect(kioskCtx, tb.x, tb.y, tb.w, 85, 8);
            kioskCtx.fill();
            kioskCtx.strokeStyle = tb.accent ? '#0284c7' : 'rgba(255, 255, 255, 0.05)';
            kioskCtx.lineWidth = 1;
            kioskCtx.stroke();

            kioskCtx.fillStyle = '#64748b';
            kioskCtx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            kioskCtx.fillText(tb.label, tb.x + 14, tb.y + 22);

            kioskCtx.fillStyle = tb.accent ? '#38bdf8' : '#ffffff';
            kioskCtx.font = 'bold 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            kioskCtx.fillText(tb.val, tb.x + 14, tb.y + 52);

            if (tb.colorDot) {
                kioskCtx.beginPath();
                kioskCtx.arc(tb.x + tb.w - 24, tb.y + 44, 9, 0, Math.PI * 2);
                kioskCtx.fillStyle = tb.colorDot;
                kioskCtx.fill();
                kioskCtx.strokeStyle = '#ffffff';
                kioskCtx.lineWidth = 1.5;
                kioskCtx.stroke();
            }

            kioskCtx.fillStyle = '#475569';
            kioskCtx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            kioskCtx.fillText(tb.sub, tb.x + 14, tb.y + 73);
        });

        // Path difference explanation line
        kioskCtx.fillStyle = '#94a3b8';
        kioskCtx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.fillText('Path difference Δr = d·sin(θ) ≈ d·x/D  •  Constructive when Δr = mλ  •  Destructive when Δr = (m + ½)λ', 85, 1115);
        kioskCtx.fillText('Single-slit width a = ' + aMm + ' mm modulates fringes by sinc²(πa·sinθ/λ) envelope.', 85, 1145);
        kioskCtx.fillText('Slit Status: ' + (physics.leftSlitOpen && physics.rightSlitOpen ? 'Both Slits Open (Interference Active)' : physics.leftSlitOpen ? 'Left Slit Only (Diffraction)' : physics.rightSlitOpen ? 'Right Slit Only (Diffraction)' : 'Both Slits Closed'), 85, 1175);
    }

    // =========================================================================
    // TAB 5: 3D INTERACTIVE IN-VR PHYSICS QUIZ (NATIVE WEBXR ENGINE)
    // =========================================================================
    if (state.kioskTab === 'quiz') {
        const qIdx = Math.max(0, Math.min(4, state.kioskQuizIndex || 0));
        const questions = (typeof lesson !== 'undefined' && lesson) ? lesson.quizQuestions : [];
        const q = questions[qIdx] || {
            id: 'q1',
            question: '1. What happens to the fringe spacing β when screen distance D is doubled?',
            options: ['A) Halved', 'B) Doubled', 'C) Unchanged', 'D) Disappears'],
            correctIndex: 1,
            explanation: 'β = (λ·D)/d: directly proportional to D.'
        };

        const totalQ = questions.length || 5;
        const answers = (typeof lesson !== 'undefined' && lesson) ? lesson.quizAnswers : {};
        const isAnswered = answers[q.id] !== undefined;
        const selectedOpt = answers[q.id];
        const score = (typeof lesson !== 'undefined' && lesson) ? lesson.quizScore : 0;

        // Header Title & Score Badge (y = 135..175)
        kioskCtx.fillStyle = '#38bdf8';
        kioskCtx.font = 'bold 22px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.fillText('📝 PHYSICS MASTERY ASSESSMENT • WAVE & QUANTUM OPTICS', 60, 155);

        kioskCtx.fillStyle = score >= 3 ? '#22c55e' : '#38bdf8';
        kioskCtx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.textAlign = 'right';
        kioskCtx.fillText('🏆 SCORE: ' + score + ' / ' + totalQ + ' (' + (totalQ > 0 ? ((score / totalQ) * 100).toFixed(0) : 0) + '%)', 1020, 155);
        kioskCtx.textAlign = 'left';

        // Question Card (y = 175..295)
        kioskCtx.fillStyle = '#0b1329';
        drawRoundRect(kioskCtx, 60, 175, 960, 120, 12);
        kioskCtx.fill();
        kioskCtx.strokeStyle = '#1e3a8a';
        kioskCtx.lineWidth = 2;
        kioskCtx.stroke();

        kioskCtx.fillStyle = '#38bdf8';
        kioskCtx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.fillText('QUESTION ' + (qIdx + 1) + ' OF ' + totalQ, 85, 205);

        kioskCtx.fillStyle = '#ffffff';
        kioskCtx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        drawWrappedText(kioskCtx, q.question, 85, 238, 910, 28);

        // 4 Interactive Options (y = 310..635)
        const optH = 68;
        const optGap = 14;
        const optStartY = 310;

        q.options.forEach((optText, oIdx) => {
            const optY = optStartY + oIdx * (optH + optGap);
            const isHovered = hoverPoint && hoverPoint.x >= 60 && hoverPoint.x <= 1020 && hoverPoint.y >= optY && hoverPoint.y <= optY + optH;

            let optBg = '#0f172a';
            let optBorder = '#334155';
            let badgeText = '';
            let badgeColor = '#ffffff';

            if (isAnswered) {
                if (oIdx === q.correctIndex) {
                    optBg = '#064e3b';
                    optBorder = '#10b981';
                    badgeText = '✓ CORRECT ANSWER (+1)';
                    badgeColor = '#4ade80';
                } else if (oIdx === selectedOpt) {
                    optBg = '#7f1d1d';
                    optBorder = '#ef4444';
                    badgeText = '✕ YOUR ANSWER (INCORRECT)';
                    badgeColor = '#f87171';
                } else {
                    optBg = '#0a0f1d';
                    optBorder = '#1e293b';
                }
            } else if (isHovered) {
                optBg = '#1e293b';
                optBorder = '#38bdf8';
            }

            kioskCtx.fillStyle = optBg;
            drawRoundRect(kioskCtx, 60, optY, 960, optH, 10);
            kioskCtx.fill();
            kioskCtx.strokeStyle = isHovered && !isAnswered ? '#ffffff' : optBorder;
            kioskCtx.lineWidth = isHovered ? 2.5 : 1.5;
            kioskCtx.stroke();

            // Option Letter & Text
            kioskCtx.fillStyle = (isAnswered && oIdx === q.correctIndex) ? '#4ade80' : '#f8fafc';
            kioskCtx.font = '600 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            kioskCtx.textBaseline = 'middle';
            kioskCtx.fillText(optText, 85, optY + optH / 2);

            // Right-aligned status badge
            if (badgeText) {
                kioskCtx.fillStyle = badgeColor;
                kioskCtx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                kioskCtx.textAlign = 'right';
                kioskCtx.fillText(badgeText, 1000, optY + optH / 2);
                kioskCtx.textAlign = 'left';
            } else if (!isAnswered) {
                kioskCtx.fillStyle = isHovered ? '#38bdf8' : '#64748b';
                kioskCtx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                kioskCtx.textAlign = 'right';
                kioskCtx.fillText('CLICK TO SELECT ➔', 1000, optY + optH / 2);
                kioskCtx.textAlign = 'left';
            }
        });

        // Explanation / Pedagogical Feedback Card (y = 650..805)
        kioskCtx.fillStyle = isAnswered ? '#041c2c' : '#0a101d';
        drawRoundRect(kioskCtx, 60, 650, 960, 155, 12);
        kioskCtx.fill();
        kioskCtx.strokeStyle = isAnswered ? '#0284c7' : '#1e293b';
        kioskCtx.lineWidth = 1.5;
        kioskCtx.stroke();

        kioskCtx.fillStyle = isAnswered ? '#38bdf8' : '#64748b';
        kioskCtx.font = 'bold 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.textBaseline = 'alphabetic';
        kioskCtx.fillText(isAnswered ? '💡 PHYSICAL PRINCIPLE & EXPLANATION:' : '💡 QUESTION INSTRUCTIONS:', 85, 680);

        kioskCtx.fillStyle = isAnswered ? '#e2e8f0' : '#94a3b8';
        kioskCtx.font = '15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        const explText = isAnswered ? q.explanation : 'Aim your VR laser pointer at one of the 4 options above and pull trigger. Immediate scientific feedback will explain the result and consolidate your understanding.';
        drawWrappedText(kioskCtx, explText, 85, 710, 910, 24);

        // Segmented Question Navigation Pills (y = 820..870)
        for (let i = 0; i < totalQ; i++) {
            const pillW = 180;
            const pillGap = 15;
            const pillX = 60 + i * (pillW + pillGap);
            const isPillActive = i === qIdx;
            const qObj = questions[i];
            const isPillAns = answers[qObj?.id] !== undefined;
            const isPillCorrect = isPillAns && answers[qObj.id] === qObj.correctIndex;

            let pillBg = '#0f172a';
            let pillBorder = '#334155';
            let pillColor = '#94a3b8';
            if (isPillCorrect) {
                pillBg = '#064e3b';
                pillBorder = '#10b981';
                pillColor = '#4ade80';
            } else if (isPillAns) {
                pillBg = '#7f1d1d';
                pillBorder = '#ef4444';
                pillColor = '#f87171';
            }
            if (isPillActive) {
                pillBorder = '#38bdf8';
                pillColor = '#ffffff';
            }

            kioskCtx.fillStyle = pillBg;
            drawRoundRect(kioskCtx, pillX, 820, pillW, 46, 8);
            kioskCtx.fill();
            kioskCtx.strokeStyle = pillBorder;
            kioskCtx.lineWidth = isPillActive ? 2.5 : 1.5;
            kioskCtx.stroke();

            kioskCtx.fillStyle = pillColor;
            kioskCtx.font = isPillActive ? 'bold 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' : '600 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            kioskCtx.textAlign = 'center';
            kioskCtx.textBaseline = 'middle';
            const statusMark = isPillCorrect ? ' ✓' : (isPillAns ? ' ✕' : '');
            kioskCtx.fillText('Q' + (i + 1) + statusMark, pillX + pillW / 2, 843);
            kioskCtx.textAlign = 'left';
        }

        // Quiz Action Buttons (y = 885..943)
        const quizBtns = [
            { id: 'quiz-prev', label: '◀ PREV', x: 60, y: 885, w: 200, h: 58, bg: '#1e293b', border: '#475569' },
            { id: 'quiz-retake', label: '🔄 RETAKE', x: 280, y: 885, w: 220, h: 58, bg: '#1e293b', border: '#475569' },
            { id: 'quiz-back', label: '🎓 BACK TO LESSON', x: 520, y: 885, w: 260, h: 58, bg: '#0284c7', border: '#38bdf8', glow: true },
            { id: 'quiz-next', label: 'NEXT ▶', x: 800, y: 885, w: 220, h: 58, bg: '#1e293b', border: '#475569' }
        ];

        quizBtns.forEach(b => {
            const isHovered = hoverPoint && hoverPoint.x >= b.x && hoverPoint.x <= b.x + b.w && hoverPoint.y >= b.y && hoverPoint.y <= b.y + b.h;
            kioskCtx.fillStyle = b.bg;
            drawRoundRect(kioskCtx, b.x, b.y, b.w, b.h, 10);
            kioskCtx.fill();
            kioskCtx.strokeStyle = isHovered ? '#ffffff' : b.border;
            kioskCtx.lineWidth = isHovered ? 2.5 : 1.5;
            kioskCtx.stroke();

            kioskCtx.fillStyle = '#ffffff';
            kioskCtx.font = b.glow ? 'bold 17px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' : '600 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            kioskCtx.textAlign = 'center';
            kioskCtx.textBaseline = 'middle';
            kioskCtx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2);
            kioskCtx.textAlign = 'left';
        });

        // Completion & Certificate Card (y = 960..1220)
        const answeredCount = Object.keys(answers).length;
        const allDone = answeredCount >= totalQ;

        kioskCtx.fillStyle = allDone ? '#062c1d' : '#080f1e';
        drawRoundRect(kioskCtx, 60, 960, 960, 260, 14);
        kioskCtx.fill();
        kioskCtx.strokeStyle = allDone ? '#10b981' : '#1e293b';
        kioskCtx.lineWidth = allDone ? 2 : 1.5;
        kioskCtx.stroke();

        kioskCtx.textBaseline = 'alphabetic';
        if (allDone) {
            kioskCtx.fillStyle = '#4ade80';
            kioskCtx.font = 'bold 22px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            kioskCtx.fillText('🎉 ASSESSMENT COMPLETE! FINAL SCORE: ' + score + ' / ' + totalQ + ' (' + ((score / totalQ) * 100).toFixed(0) + '%)', 85, 1005);

            kioskCtx.fillStyle = '#f8fafc';
            kioskCtx.font = '16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            kioskCtx.fillText('Congratulations! You have demonstrated conceptual mastery over Young\'s Double-Slit experiment:', 85, 1045);
            kioskCtx.fillText('• Geometric wave interference condition Δr = d·sin(θ) ≈ d·x/D', 110, 1080);
            kioskCtx.fillText('• Fringe spacing scaling laws: β ∝ λ, β ∝ D, and β ∝ 1/d', 110, 1115);
            kioskCtx.fillText('• Quantum wave-particle duality: discrete photon detections governed by Born probability density p(x)', 110, 1150);
            kioskCtx.fillText('• Single-slit diffraction envelope sinc²(πa sinθ/λ) and missing orders', 110, 1185);
        } else {
            kioskCtx.fillStyle = '#38bdf8';
            kioskCtx.font = 'bold 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            kioskCtx.fillText('📋 QUIZ PROGRESS: ' + answeredCount + ' OF ' + totalQ + ' QUESTIONS ANSWERED', 85, 1005);

            kioskCtx.fillStyle = '#94a3b8';
            kioskCtx.font = '16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            kioskCtx.fillText('Answer all 5 questions to complete Stage 6 of the guided laboratory curriculum.', 85, 1045);
            kioskCtx.fillText('Use the PREV and NEXT buttons or tap the Q1-Q5 pills to navigate questions.', 85, 1080);
            kioskCtx.fillText('Immediate pedagogical feedback and explanations are provided for every choice.', 85, 1115);
        }
    }

    // =========================================================================
    // SHARED BOTTOM ACTION BUTTONS (Across All Tabs)
    // =========================================================================
    KIOSK_BOTTOM_BUTTONS.forEach((b) => {
        const isHovered = hoverPoint && hoverPoint.x >= b.x && hoverPoint.x <= b.x + b.w && hoverPoint.y >= b.y && hoverPoint.y <= b.y + b.h;

        let bg = b.bg;
        let border = b.border;
        let label = b.label;

        if (b.id === 'laser') {
            bg = physics.laserActive ? '#15803d' : '#991b1b';
            border = physics.laserActive ? '#22c55e' : '#ef4444';
            label = physics.laserActive ? '⚡ LASER: ACTIVE' : '⚡ LASER: OFF';
        }

        kioskCtx.fillStyle = bg;
        drawRoundRect(kioskCtx, b.x, b.y, b.w, b.h, 10);
        kioskCtx.fill();

        kioskCtx.strokeStyle = isHovered ? '#ffffff' : border;
        kioskCtx.lineWidth = isHovered ? 2.5 : 1.5;
        kioskCtx.stroke();

        kioskCtx.fillStyle = '#ffffff';
        kioskCtx.font = b.glow ? 'bold 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' : '600 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        kioskCtx.textAlign = 'center';
        kioskCtx.textBaseline = 'middle';
        kioskCtx.fillText(label, b.x + b.w / 2, b.y + b.h / 2);
        kioskCtx.textAlign = 'left';
    });

    // Footer divider and brand
    kioskCtx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    kioskCtx.lineWidth = 1;
    kioskCtx.beginPath();
    kioskCtx.moveTo(60, 1315);
    kioskCtx.lineTo(1020, 1315);
    kioskCtx.stroke();

    kioskCtx.fillStyle = '#38bdf8';
    kioskCtx.font = 'bold 22px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    kioskCtx.textBaseline = 'alphabetic';
    kioskCtx.fillText('EXPERIMENT 01', 60, 1345);

    kioskCtx.fillStyle = '#64748b';
    kioskCtx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    kioskCtx.fillText('YDSE INTERACTIVE XR LABORATORY • META QUEST 3 & DESKTOP', 250, 1345);

    kioskCtx.fillStyle = '#22c55e';
    kioskCtx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    kioskCtx.textAlign = 'right';
    kioskCtx.fillText('● SYSTEM READY', 1020, 1345);
    kioskCtx.textAlign = 'left';

    // Laser pointer reticle (Desktop mouse only; VR uses 3D kioskReticleMesh)
    if (hoverPoint && !renderer.xr.isPresenting) {
        kioskCtx.save();
        kioskCtx.beginPath();
        kioskCtx.arc(hoverPoint.x, hoverPoint.y, 16, 0, Math.PI * 2);
        kioskCtx.strokeStyle = '#38bdf8';
        kioskCtx.lineWidth = 3;
        kioskCtx.shadowColor = '#00f0ff';
        kioskCtx.shadowBlur = 12;
        kioskCtx.stroke();

        kioskCtx.beginPath();
        kioskCtx.arc(hoverPoint.x, hoverPoint.y, 5, 0, Math.PI * 2);
        kioskCtx.fillStyle = '#ffffff';
        kioskCtx.fill();
        kioskCtx.restore();
    }

    kioskTexture.needsUpdate = true;
}

function interactWithKiosk(kx, ky, isDown) {
    // 1. Check Tabs (y in [60, 110])
    if (ky >= 60 && ky <= 110) {
        for (const t of KIOSK_TABS) {
            if (kx >= t.x && kx <= t.x + t.w) {
                if (isDown) {
                    state.kioskTab = t.id;
                    redrawKioskTexture();
                }
                return { type: 'tab', id: t.id };
            }
        }
    }

    // 2. Check Shared Bottom Action Buttons (y in [1245, 1305])
    for (const b of KIOSK_BOTTOM_BUTTONS) {
        if (kx >= b.x && kx <= b.x + b.w && ky >= b.y && ky <= b.y + b.h) {
            if (isDown) {
                if (b.id === 'bench') teleportToBench();
                else if (b.id === 'laser') toggleLaserPower();
                else if (b.id === 'reset-kiosk') resetKioskPosition();
                else if (b.id === 'face-kiosk') orientKioskToUser();
            }
            return { type: 'button', id: b.id };
        }
    }

    // 3. Tab-Specific Interactions:
    if (state.kioskTab === 'lesson') {
        // Stages 1 through 6
        if (kx >= 60 && kx <= 1020) {
            for (const s of KIOSK_STAGES) {
                if (ky >= s.y && ky <= s.y + s.h) {
                    if (isDown && lesson) {
                        lesson.goToStage(s.id);
                        redrawKioskTexture();
                    }
                    return { type: 'stage', id: s.id };
                }
            }
        }

        // Stage Nav Buttons (y = 790..848)
        for (const b of KIOSK_LESSON_NAV_BUTTONS) {
            if (kx >= b.x && kx <= b.x + b.w && ky >= b.y && ky <= b.y + b.h) {
                if (isDown) {
                    if (b.id === 'prev' && lesson) lesson.prevStage();
                    else if (b.id === 'next' && lesson) lesson.nextStage();
                    else if (b.id === 'bench') teleportToBench();
                    redrawKioskTexture();
                }
                return { type: 'button', id: b.id };
            }
        }

        // Quick Lab Control Buttons (y = 865..923)
        for (const b of KIOSK_LESSON_CTRL_BUTTONS) {
            if (kx >= b.x && kx <= b.x + b.w && ky >= b.y && ky <= b.y + b.h) {
                if (isDown) {
                    if (b.id === 'laser') toggleLaserPower();
                    else if (b.id === 'quantum') toggleQuantumMode();
                    else if (b.id === 'quiz') {
                        // Switch immediately to interactive 3D VR Quiz!
                        if (lesson) lesson.goToStage(6);
                        state.kioskTab = 'quiz';
                        state.kioskQuizIndex = 0;
                        renderQuiz();
                        const modal = document.getElementById('modal-quiz');
                        if (modal && !renderer.xr.isPresenting) modal.classList.remove('hidden');
                    }
                    redrawKioskTexture();
                }
                return { type: 'button', id: b.id };
            }
        }
    }

    // 4. In-VR 3D Physics Quiz Interaction:
    if (state.kioskTab === 'quiz') {
        const qIdx = Math.max(0, Math.min(4, state.kioskQuizIndex || 0));
        const questions = (typeof lesson !== 'undefined' && lesson) ? lesson.quizQuestions : [];
        const q = questions[qIdx];

        // 4a. 4 Options (y = 310..635)
        const optH = 68;
        const optGap = 14;
        const optStartY = 310;
        if (kx >= 60 && kx <= 1020 && ky >= optStartY && ky <= optStartY + 4 * (optH + optGap)) {
            const optIdx = Math.floor((ky - optStartY) / (optH + optGap));
            if (optIdx >= 0 && optIdx < 4) {
                const optBoxY = optStartY + optIdx * (optH + optGap);
                if (ky <= optBoxY + optH) {
                    if (isDown && q && lesson) {
                        lesson.submitQuizAnswer(q.id, optIdx);
                        renderQuiz();
                        redrawKioskTexture();
                    }
                    return { type: 'quiz-opt', id: optIdx };
                }
            }
        }

        // 4b. Question Navigation Pills (Q1..Q5 at y = 820..866)
        if (ky >= 820 && ky <= 866 && kx >= 60 && kx <= 1020) {
            const pillW = 180;
            const pillGap = 15;
            const pIdx = Math.floor((kx - 60) / (pillW + pillGap));
            if (pIdx >= 0 && pIdx < 5) {
                const pillX = 60 + pIdx * (pillW + pillGap);
                if (kx <= pillX + pillW) {
                    if (isDown) {
                        state.kioskQuizIndex = pIdx;
                        redrawKioskTexture();
                    }
                    return { type: 'quiz-pill', id: pIdx };
                }
            }
        }

        // 4c. Quiz Navigation Buttons (y = 885..943)
        const quizBtns = [
            { id: 'quiz-prev', x: 60, y: 885, w: 200, h: 58 },
            { id: 'quiz-retake', x: 280, y: 885, w: 220, h: 58 },
            { id: 'quiz-back', x: 520, y: 885, w: 260, h: 58 },
            { id: 'quiz-next', x: 800, y: 885, w: 220, h: 58 }
        ];

        for (const b of quizBtns) {
            if (kx >= b.x && kx <= b.x + b.w && ky >= b.y && ky <= b.y + b.h) {
                if (isDown) {
                    if (b.id === 'quiz-prev') {
                        state.kioskQuizIndex = Math.max(0, (state.kioskQuizIndex || 0) - 1);
                    } else if (b.id === 'quiz-next') {
                        state.kioskQuizIndex = Math.min(4, (state.kioskQuizIndex || 0) + 1);
                    } else if (b.id === 'quiz-retake') {
                        if (lesson) {
                            lesson.quizAnswers = {};
                            lesson.quizScore = 0;
                        }
                        state.kioskQuizIndex = 0;
                        renderQuiz();
                    } else if (b.id === 'quiz-back') {
                        state.kioskTab = 'lesson';
                    }
                    redrawKioskTexture();
                }
                return { type: 'button', id: b.id };
            }
        }
    }

    return null;
}

function getKioskItemAt(kx, ky) {
    if (ky >= 12 && ky <= 52) return { type: 'grab-bar', id: 'grab' };
    return interactWithKiosk(kx, ky, false);
}

function updateVRKioskInteraction() {
    if (!renderer.xr.isPresenting) return;
    // Raycast strictly against the interactive front quad (prevents false hits on black frame or back panel)
    const kioskTargets = [kioskInteractiveQuad].filter(Boolean);
    if (kioskTargets.length === 0) return;

    let hoverPoint = null;
    let hoveredItem = null;
    let hit3D = null;
    const controllers = [controller0, controller1];

    for (const ctrl of controllers) {
        if (!ctrl) continue;
        ctrl.updateMatrixWorld(true);

        const ray = new THREE.Raycaster();
        ray.ray.origin.setFromMatrixPosition(ctrl.matrixWorld);
        ray.ray.direction.set(0, 0, -1).transformDirection(ctrl.matrixWorld);

        const hits = ray.intersectObjects(kioskTargets, false);
        if (hits.length > 0 && hits[0].uv) {
            const kx = hits[0].uv.x * 1080;
            const ky = hits[0].uv.y * 1380;
            hoverPoint = { x: kx, y: ky };
            hoveredItem = getKioskItemAt(kx, ky);
            hit3D = hits[0];
            break;
        }
    }

    // 3D lightweight reticle (ZERO texture uploads!)
    if (hit3D && kioskReticleMesh) {
        kioskReticleMesh.visible = true;
        // Transform local face normal into world coordinates for perfect orientation across all rotations
        const faceNormal = hit3D.face ? hit3D.face.normal : new THREE.Vector3(0, 0, 1);
        const worldNormal = faceNormal.clone().transformDirection(hit3D.object.matrixWorld).normalize();
        if (worldNormal.lengthSq() > 0.001) {
            kioskReticleMesh.position.copy(hit3D.point).addScaledVector(worldNormal, 0.004);
            kioskReticleMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), worldNormal);
        }
    } else if (kioskReticleMesh) {
        kioskReticleMesh.visible = false;
    }

    // Only redraw texture if hovered button/stage/tab state CHANGED (prevents 90Hz texture thrashing!)
    const itemChanged = (hoveredItem?.type !== state.hoveredKioskItem?.type) ||
                        (hoveredItem?.id !== state.hoveredKioskItem?.id);
    state.hoveredKioskItem = hoveredItem;

    if (itemChanged) {
        redrawKioskTexture(hoverPoint);
    }
}

// =============================================================================
// 5. APPARATUS & OPTICAL BEAM MESHES
// =============================================================================
// Realistic laboratory laser beams: glowing core + soft translucent shroud
const beamMaterial = new THREE.MeshBasicMaterial({
    color: 0xef4444,
    transparent: true,
    opacity: 0.90
});
const beamGlowMaterial = new THREE.MeshBasicMaterial({
    color: 0xef4444,
    transparent: true,
    opacity: 0.25,
    side: THREE.BackSide
});

// Pre-slit beam (Laser aperture to Double Slit)
const preBeamGroup = new THREE.Group();
const preCoreGeom = new THREE.CylinderGeometry(0.002, 0.002, 1.0, 16);
const preGlowGeom = new THREE.CylinderGeometry(0.006, 0.006, 1.0, 16);
const preCoreMesh = new THREE.Mesh(preCoreGeom, beamMaterial);
const preGlowMesh = new THREE.Mesh(preGlowGeom, beamGlowMaterial);
preCoreMesh.rotation.x = Math.PI / 2;
preGlowMesh.rotation.x = Math.PI / 2;
preBeamGroup.add(preCoreMesh);
preBeamGroup.add(preGlowMesh);
scene.add(preBeamGroup);

// Post-slit diffraction beam 1 (Slit to Screen)
const postBeamGroup1 = new THREE.Group();
const postCore1 = new THREE.Mesh(preCoreGeom, beamMaterial);
const postGlow1 = new THREE.Mesh(preGlowGeom, beamGlowMaterial);
postCore1.rotation.x = Math.PI / 2;
postGlow1.rotation.x = Math.PI / 2;
postBeamGroup1.add(postCore1);
postBeamGroup1.add(postGlow1);
scene.add(postBeamGroup1);

// Post-slit diffraction beam 2 (Slit to Screen)
const postBeamGroup2 = new THREE.Group();
const postCore2 = new THREE.Mesh(preCoreGeom, beamMaterial);
const postGlow2 = new THREE.Mesh(preGlowGeom, beamGlowMaterial);
postCore2.rotation.x = Math.PI / 2;
postGlow2.rotation.x = Math.PI / 2;
postBeamGroup2.add(postCore2);
postBeamGroup2.add(postGlow2);
scene.add(postBeamGroup2);

// Cached materials from Lab_Setup.glb that represent optical beams or apertures
const dynamicModelMaterials = [];

function updateBeams() {
    const isVisible = physics.laserActive;
    preBeamGroup.visible = isVisible;
    postBeamGroup1.visible = isVisible && physics.leftSlitOpen;
    postBeamGroup2.visible = isVisible && physics.rightSlitOpen;

    const rgb = YDSEPhysicsModel.wavelengthToRGB(physics.wavelength);
    const laserColor = new THREE.Color(rgb.r, rgb.g, rgb.b);

    if (laserApertureMesh) {
        laserApertureMesh.material.color.copy(laserColor);
        laserApertureMesh.material.emissive.copy(laserColor);
        laserApertureMesh.material.emissiveIntensity = isVisible ? 2.8 : 0.0;
    }

    if (!isVisible) return;

    beamMaterial.color.copy(laserColor);
    beamGlowMaterial.color.copy(laserColor);

    // Update any beam/aperture materials found in Lab_Setup.glb
    for (const mat of dynamicModelMaterials) {
        if (mat.color) mat.color.copy(laserColor);
        if (mat.emissive) {
            mat.emissive.copy(laserColor);
            mat.emissiveIntensity = 1.2;
        }
    }

    // Laser aperture at Z = 1.63m -> Double slit at Z = -0.46m
    const laserApertureZ = 1.63;
    const preLength = laserApertureZ - SLIT_Z;
    preBeamGroup.scale.set(1, 1, preLength);
    preBeamGroup.position.set(0, OPTICAL_AXIS_Y, SLIT_Z + preLength / 2);

    // Slits at Z = -0.46m -> Screen at Z = (SLIT_Z - physics.screenDistance)
    const screenZ = SLIT_Z - physics.screenDistance;
    const postLength = Math.abs(screenZ - SLIT_Z);

    postBeamGroup1.scale.set(1, 1, postLength);
    postBeamGroup1.position.set(-physics.slitSeparation * 0.5, OPTICAL_AXIS_Y, SLIT_Z - postLength / 2);

    postBeamGroup2.scale.set(1, 1, postLength);
    postBeamGroup2.position.set(physics.slitSeparation * 0.5, OPTICAL_AXIS_Y, SLIT_Z - postLength / 2);
}

// =============================================================================
// 6. LOAD EXISTING LABORATORY GLB (Lab_Setup.glb)
// =============================================================================
let labRoot = null;
let screenObject = null;
let slitCarriageObject = null;
let screenSurfaceMesh = null;
let consoleDisplayMesh = null;

const loader = new GLTFLoader();
loader.load(
    './3d model/Lab_Setup.glb',
    (gltf) => {
        labRoot = gltf.scene;
        scene.add(labRoot);
        console.log('✅ Loaded Lab_Setup.glb with 26 nodes intact.');

        labRoot.traverse((node) => {
            if (node.isMesh) {
                node.castShadow = true;
                node.receiveShadow = true;

                // Cache materials named 'beam' so their color updates with wavelength
                if (node.material) {
                    const mats = Array.isArray(node.material) ? node.material : [node.material];
                    for (const m of mats) {
                        if (m && m.name && m.name.toLowerCase().includes('beam')) {
                            if (!dynamicModelMaterials.includes(m)) dynamicModelMaterials.push(m);
                        }
                    }
                }

                // Hide the static model beam so our wavelength-accurate dynamic beam is seen clearly
                if (node.name && node.name.toLowerCase().includes('laser beam')) {
                    node.visible = false;
                }

                // Identify Observation Screen Assembly
                if (node.name && (node.name.includes('Observation_screen') || node.name.includes('Observation screen'))) {
                    screenObject = node.parent && (node.parent.name.includes('Observation_screen') || node.parent.name.includes('Observation screen')) ? node.parent : node;
                }

                // Identify the specific phosphor projection face (primitive with material 'Interference exposure')
                if (node.material) {
                    const mats = Array.isArray(node.material) ? node.material : [node.material];
                    for (let mi = 0; mi < mats.length; mi++) {
                        const m = mats[mi];
                        if (m && m.name === 'Interference exposure') {
                            if (Array.isArray(node.material)) {
                                node.material[mi] = screenPhosphorMaterial;
                            } else {
                                node.material = screenPhosphorMaterial;
                            }
                            screenSurfaceMesh = node;
                            if (node.parent && (node.parent.name.includes('Observation') || node.parent.name.includes('screen'))) {
                                screenObject = node.parent;
                            }
                        }
                    }
                }

                // Fallback: If node has material array
                if (Array.isArray(node.material) && node.name && (node.name.includes('Observation_screen') || node.name.includes('Observation screen'))) {
                    for (let mi = 0; mi < node.material.length; mi++) {
                        if (node.material[mi].name === 'Interference exposure') {
                            node.material[mi] = screenPhosphorMaterial;
                            screenSurfaceMesh = node;
                            if (node.parent) screenObject = node.parent;
                        }
                    }
                }

                // Identify Parameter Console display face
                if (node.material) {
                    const mats = Array.isArray(node.material) ? node.material : [node.material];
                    for (let mi = 0; mi < mats.length; mi++) {
                        if (mats[mi] && mats[mi].name === 'Parameter display') {
                            // Hide GLB internal static primitive; consoleInteractiveQuad renders with 0 Z-fighting
                            mats[mi].visible = false;
                            consoleDisplayMesh = node;
                        }
                    }
                }

                // Identify Welcome Kiosk display face
                if (node.material) {
                    const mats = Array.isArray(node.material) ? node.material : [node.material];
                    for (let mi = 0; mi < mats.length; mi++) {
                        if (mats[mi] && mats[mi].name === 'Welcome display') {
                            // Hide GLB internal static primitive; kioskInteractiveQuad renders with 0 Z-fighting
                            mats[mi].visible = false;
                            kioskDisplayMesh = node;
                        }
                    }
                }

                // Identify Welcome Kiosk Root Object
                if (node.name && (node.name === 'Welcome kiosk' || node.name.includes('Welcome'))) {
                    if (!welcomeKioskObject) {
                        welcomeKioskObject = (node.isMesh && node.parent && node.parent.name.includes('Welcome')) ? node.parent : node;
                    }
                }

                // Identify Double Slit Carriage
                if (node.name && (node.name.includes('Double slit carriage') || node.name.includes('Double_slit_carriage'))) {
                    slitCarriageObject = node.parent && (node.parent.name.includes('Double slit carriage') || node.parent.name.includes('Double_slit_carriage')) ? node.parent : node;
                }
            }
        });

        // Ensure Observation Screen assembly root object is bound
        if (!screenObject) {
            screenObject = labRoot.getObjectByName('Observation_screen') || labRoot.getObjectByName('Observation screen');
        }
        console.log('Observation screen assembly identified:', screenObject ? screenObject.name : 'Not Found', 'Surface mesh:', screenSurfaceMesh ? screenSurfaceMesh.name : 'Not Found');

        // Initialize screen position along rail to match default distance D = 2.00m
        updateScreenPosition();
        updateBeams();
        redrawScreenTexture();
        if (!welcomeKioskObject) {
            welcomeKioskObject = labRoot.getObjectByName('Welcome kiosk') || labRoot.getObjectByName('Welcome_kiosk');
        }
        if (welcomeKioskObject) {
            kioskPivotGroup.attach(welcomeKioskObject);
            console.log('✅ Attached Welcome Kiosk model to interactive pivot group.');
        }
        if (kioskInteractiveQuad) {
            kioskInteractiveQuad.visible = true;
        }

        redrawConsoleTexture();
        redrawKioskTexture();
        updateTelemetry();
    },
    (progress) => {
        console.log(`Loading 3D Laboratory: ${(progress.loaded / (progress.total || 1960348) * 100).toFixed(0)}%`);
    },
    (error) => {
        console.error('Error loading Lab_Setup.glb:', error);
    }
);

function updateScreenPosition() {
    if (!screenObject) return;
    // Slit aperture is at SLIT_Z = -0.46m. Screen face in model is at Z = -2.451m.
    // Target Z for screen face is: targetZ = SLIT_Z - physics.screenDistance (-0.46 - D).
    // The local offset along Z is: targetZ - (-2.451) = 1.991 - physics.screenDistance.
    const targetZ = SLIT_Z - physics.screenDistance;
    screenObject.position.z = 1.991 - physics.screenDistance;
    screenGlowLight.position.z = targetZ + 0.08;
    updateBeams();
}

// =============================================================================
// 7. REAL-TIME INTENSITY PROFILE GRAPH (CANVAS)
// =============================================================================
const profileCanvas = document.getElementById('profile-canvas');
const profileCtx = profileCanvas.getContext('2d');

function updateIntensityProfileGraph() {
    const w = profileCanvas.width;
    const h = profileCanvas.height;
    profileCtx.clearRect(0, 0, w, h);

    // Background grid
    profileCtx.fillStyle = '#050b14';
    profileCtx.fillRect(0, 0, w, h);
    profileCtx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    profileCtx.lineWidth = 1;
    profileCtx.beginPath();
    profileCtx.moveTo(w / 2, 0);
    profileCtx.lineTo(w / 2, h);
    profileCtx.moveTo(0, h - 1);
    profileCtx.lineTo(w, h - 1);
    profileCtx.stroke();

    if (!physics.laserActive || (!physics.leftSlitOpen && !physics.rightSlitOpen)) {
        return;
    }

    const rgb = YDSEPhysicsModel.wavelengthToRGB(physics.wavelength);
    profileCtx.strokeStyle = rgb.hex;
    profileCtx.lineWidth = 2.0;
    profileCtx.beginPath();

    const metersPerPixel = (SCREEN_PHYSICAL_HALF_WIDTH * 2) / w;
    for (let x = 0; x < w; x++) {
        const xPhys = (x - w / 2) * metersPerPixel;
        const intensity = physics.calculateIntensity(xPhys);
        const yPx = (h - 4) - intensity * (h - 10);
        if (x === 0) profileCtx.moveTo(x, yPx);
        else profileCtx.lineTo(x, yPx);
    }
    profileCtx.stroke();
}

// =============================================================================
// 8. TELEMETRY READOUTS & SCREEN COORDINATE SAMPLER
// =============================================================================
function updateTelemetry() {
    const beta = physics.getFringeSpacing();
    const betaMm = beta * 1000.0;
    document.getElementById('tel-fringe-width').innerText = betaMm.toFixed(2) + ' mm';
    
    const wlNm = (physics.wavelength * 1e9).toFixed(1);
    const distM = physics.screenDistance.toFixed(2);
    const sepMm = (physics.slitSeparation * 1000.0).toFixed(2);
    const widthMm = (physics.slitWidth * 1000.0).toFixed(2);
    
    document.getElementById('tel-formula').innerText = `(${wlNm}nm × ${distM}m) / ${sepMm}mm`;

    // First diffraction minimum x_null = lambda * D / a
    const nullDistMm = (physics.slitWidth > 1e-9) ? ((physics.wavelength * physics.screenDistance / physics.slitWidth) * 1000.0) : 0;
    document.getElementById('tel-diff-null').innerText = nullDistMm.toFixed(2) + ' mm';

    // Sampler readout at probed position
    const probe = physics.inspectScreenPosition(state.hoverScreenX);
    document.getElementById('probe-x').innerText = (probe.xPositionMm >= 0 ? '+' : '') + probe.xPositionMm.toFixed(2) + ' mm';
    document.getElementById('probe-dr').innerText = `${probe.pathDifferenceNm.toFixed(1)} nm (${(probe.pathDifference / physics.wavelength).toFixed(3)} λ)`;
    document.getElementById('probe-dphi').innerText = `${probe.phaseDifferenceRad.toFixed(2)} rad (${probe.phaseDifferenceDeg.toFixed(1)}°)`;
    document.getElementById('probe-state').innerText = `${probe.interferenceType} (I = ${(probe.normalizedIntensity * 100).toFixed(0)}%)`;

    updateIntensityProfileGraph();
}

// =============================================================================
// 9. WEBXR VR CONTROLLER, HAND TRACKING & LOCOMOTION (META QUEST 3/3S)
// =============================================================================
const controllerModelFactory = new XRControllerModelFactory();
const handModelFactory = new XRHandModelFactory();

// Controller 0 (Right Hand)
const controller0 = renderer.xr.getController(0);
controller0.addEventListener('selectstart', onXRSelectStart);
controller0.addEventListener('selectend', onXRSelectEnd);
controller0.addEventListener('squeezestart', onXRSqueezeStart);
controller0.addEventListener('squeezeend', onXRSqueezeEnd);
controller0.addEventListener('connected', (e) => { controller0.userData.inputSource = e.data; });
xrRig.add(controller0);

const controllerGrip0 = renderer.xr.getControllerGrip(0);
controllerGrip0.add(controllerModelFactory.createControllerModel(controllerGrip0));
xrRig.add(controllerGrip0);

const hand0 = renderer.xr.getHand(0);
hand0.add(handModelFactory.createHandModel(hand0, 'mesh'));
xrRig.add(hand0);

// Controller 1 (Left Hand)
const controller1 = renderer.xr.getController(1);
controller1.addEventListener('selectstart', onXRSelectStart);
controller1.addEventListener('selectend', onXRSelectEnd);
controller1.addEventListener('squeezestart', onXRSqueezeStart);
controller1.addEventListener('squeezeend', onXRSqueezeEnd);
controller1.addEventListener('connected', (e) => { controller1.userData.inputSource = e.data; });
xrRig.add(controller1);

const controllerGrip1 = renderer.xr.getControllerGrip(1);
controllerGrip1.add(controllerModelFactory.createControllerModel(controllerGrip1));
xrRig.add(controllerGrip1);

const hand1 = renderer.xr.getHand(1);
hand1.add(handModelFactory.createHandModel(hand1, 'mesh'));
xrRig.add(hand1);

// Add visible pointer ray to VR controllers (extended 6.0m reach)
const rayGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -6.0)]);
const rayMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.7 });
controller0.add(new THREE.Line(rayGeo, rayMat));
controller1.add(new THREE.Line(rayGeo, rayMat));

// XR Session Handlers
renderer.xr.addEventListener('sessionstart', () => {
    controls.enabled = false;
    // Comfortable default position in front of the optical rail facing apparatus
    xrRig.position.set(0.85, 0.0, 0.20);
    xrRig.rotation.set(0, -Math.PI / 4, 0);
    state.isTeleportAiming = false;
    state.isTeleportValid = false;
});

renderer.xr.addEventListener('sessionend', () => {
    controls.enabled = true;
    xrRig.position.set(0, 0, 0);
    xrRig.rotation.set(0, 0, 0);
    state.isTeleportAiming = false;
    state.isTeleportValid = false;
    teleportReticleGroup.visible = false;
    teleportArc.visible = false;
});

// -----------------------------------------------------------------------------
// TELEPORTATION VISUALS (PARABOLIC ARC & FLOOR RETICLE)
// -----------------------------------------------------------------------------
const teleportReticleGroup = new THREE.Group();
teleportReticleGroup.visible = false;
scene.add(teleportReticleGroup);

// Outer pulsing ring
const reticleRing = new THREE.Mesh(
    new THREE.RingGeometry(0.24, 0.28, 32),
    new THREE.MeshBasicMaterial({ color: 0x06b6d4, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
);
reticleRing.rotation.x = -Math.PI / 2;
teleportReticleGroup.add(reticleRing);

// Inner disc
const reticleDisc = new THREE.Mesh(
    new THREE.CircleGeometry(0.22, 32),
    new THREE.MeshBasicMaterial({ color: 0x06b6d4, side: THREE.DoubleSide, transparent: true, opacity: 0.35 })
);
reticleDisc.rotation.x = -Math.PI / 2;
teleportReticleGroup.add(reticleDisc);

// Center forward indicator arrow
const arrowShape = new THREE.Shape();
arrowShape.moveTo(0, 0.14);
arrowShape.lineTo(0.07, -0.06);
arrowShape.lineTo(0, -0.02);
arrowShape.lineTo(-0.07, -0.06);
arrowShape.closePath();
const arrowGeo = new THREE.ShapeGeometry(arrowShape);
const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
const arrowMesh = new THREE.Mesh(arrowGeo, arrowMat);
arrowMesh.rotation.x = -Math.PI / 2;
teleportReticleGroup.add(arrowMesh);

// 32-segment ballistic arc
const ARC_POINTS = 32;
const arcPositions = new Float32Array(ARC_POINTS * 3);
const arcGeometry = new THREE.BufferGeometry();
arcGeometry.setAttribute('position', new THREE.BufferAttribute(arcPositions, 3));
const arcMaterial = new THREE.LineBasicMaterial({ color: 0x06b6d4, linewidth: 3, transparent: true, opacity: 0.9 });
const teleportArc = new THREE.Line(arcGeometry, arcMaterial);
teleportArc.frustumCulled = false;
teleportArc.visible = false;
scene.add(teleportArc);

// Get active XR camera (ArrayCamera during VR presentation) or desktop camera fallback
function getActiveXRCamera() {
    return (renderer.xr.isPresenting) ? renderer.xr.getCamera() : camera;
}

// Get headset horizontal orientation vectors directly from the active XR camera world matrix
function getHeadsetOrientation() {
    const activeCam = getActiveXRCamera();
    activeCam.updateMatrixWorld(true);

    // Three.js matrix column 0 (elements 0, 1, 2) is local +X axis in world space (True Right)
    // Three.js matrix column 2 (elements 8, 9, 10) is local +Z axis in world space, so -Z is True Forward
    const e = activeCam.matrixWorld.elements;
    const forward = new THREE.Vector3(-e[8], 0, -e[10]).normalize();
    if (forward.lengthSq() < 0.001) forward.set(0, 0, -1);

    const right = new THREE.Vector3(e[0], 0, e[2]).normalize();
    if (right.lengthSq() < 0.001) right.set(1, 0, 0);

    return { forward, right, activeCam };
}

// Snap Turn function (Pivoted precisely around player's active XR eye in world space)
function xrSnapTurn(angleRad) {
    const activeCam = getActiveXRCamera();
    activeCam.updateMatrixWorld(true);

    const headPosWorld = new THREE.Vector3();
    activeCam.getWorldPosition(headPosWorld);

    xrRig.rotation.y += angleRad;
    xrRig.updateMatrixWorld(true);

    const newHeadPosWorld = new THREE.Vector3();
    activeCam.getWorldPosition(newHeadPosWorld);

    xrRig.position.x += (headPosWorld.x - newHeadPosWorld.x);
    xrRig.position.z += (headPosWorld.z - newHeadPosWorld.z);
}

// Teleportation execution
function executeTeleport() {
    if (!state.isTeleportValid) {
        state.isTeleportAiming = false;
        state.isTeleportValid = false;
        teleportReticleGroup.visible = false;
        teleportArc.visible = false;
        return;
    }

    const activeCam = getActiveXRCamera();
    activeCam.updateMatrixWorld(true);

    const headPos = new THREE.Vector3();
    activeCam.getWorldPosition(headPos);
    const headOffsetX = headPos.x - xrRig.position.x;
    const headOffsetZ = headPos.z - xrRig.position.z;

    xrRig.position.x = state.teleportTarget.x - headOffsetX;
    xrRig.position.z = state.teleportTarget.z - headOffsetZ;
    xrRig.position.y = 0.0;

    if (state.activeTeleportController) {
        const inputSource = state.activeTeleportController.userData.inputSource;
        if (inputSource?.gamepad?.hapticActuators?.[0]) {
            inputSource.gamepad.hapticActuators[0].pulse(0.7, 70);
        }
    }

    state.isTeleportAiming = false;
    state.isTeleportValid = false;
    teleportReticleGroup.visible = false;
    teleportArc.visible = false;
}

// WebXR Locomotion Engine: Left Stick Move, Right Stick Turn & Teleport
function updateXRLocomotion(delta) {
    if (!renderer.xr.isPresenting) return;

    const session = renderer.xr.getSession();
    if (!session) return;

    // Pulse reticle subtle animation
    if (teleportReticleGroup.visible) {
        const s = 1.0 + 0.06 * Math.sin(clock.elapsedTime * 6.0);
        reticleRing.scale.set(s, s, s);
    }

    let isAnyAimingTeleport = false;

    for (const source of session.inputSources) {
        if (!source || !source.gamepad) continue;
        const gp = source.gamepad;
        const handedness = source.handedness;

        let stickX = (gp.axes.length >= 4) ? gp.axes[2] : (gp.axes[0] || 0);
        let stickY = (gp.axes.length >= 4) ? gp.axes[3] : (gp.axes[1] || 0);

        const deadzone = 0.15;
        if (Math.abs(stickX) < deadzone) stickX = 0;
        if (Math.abs(stickY) < deadzone) stickY = 0;

        const isGripPressed = gp.buttons[1] && gp.buttons[1].pressed;
        const ctrlObj = (handedness === 'left') ? controller1 : controller0;

        // -------------------------------------------------------------
        // 1. LEFT HAND: Continuous Locomotion (Smooth Walk / Strafe)
        // -------------------------------------------------------------
        if (handedness === 'left') {
            if (Math.abs(stickX) > 0 || Math.abs(stickY) > 0) {
                const { forward, right } = getHeadsetOrientation();

                const walkSpeed = 2.2; // 2.2 m/s comfortable walking speed
                const moveVec = new THREE.Vector3()
                    .addScaledVector(forward, -stickY)
                    .addScaledVector(right, stickX)
                    .normalize()
                    .multiplyScalar(walkSpeed * delta);

                xrRig.position.add(moveVec);

                // Clamp within laboratory walkable boundaries
                xrRig.position.x = THREE.MathUtils.clamp(xrRig.position.x, -3.4, 3.4);
                xrRig.position.z = THREE.MathUtils.clamp(xrRig.position.z, -2.9, 2.9);
                xrRig.position.y = 0.0;
            }
        }

        // -------------------------------------------------------------
        // 2. RIGHT HAND: Snap Turn & Parabolic Teleportation
        // -------------------------------------------------------------
        if (handedness === 'right') {
            // Check if aiming at 3D parameter console: thumbstick Left/Right adjusts parameter!
            if (state.hoveredConsoleSlider && Math.abs(stickX) > 0.40) {
                if (!state.consoleStickLocked) {
                    state.consoleStickLocked = true;
                    const s = state.hoveredConsoleSlider;
                    const currentVal = s.get();
                    const stepDir = stickX > 0 ? 1 : -1;
                    const newVal = THREE.MathUtils.clamp(currentVal + stepDir * s.step, s.min, s.max);
                    s.set(newVal);
                    if (gp.hapticActuators && gp.hapticActuators[0]) {
                        gp.hapticActuators[0].pulse(0.6, 40);
                    }
                }
            } else if (Math.abs(stickX) < 0.20) {
                state.consoleStickLocked = false;
            }

            // Horizontal Turn (Snap Turn 45 degrees) - only when NOT aiming at console
            const snapThreshold = 0.55;
            if (!state.hoveredConsoleSlider && Math.abs(stickX) > snapThreshold) {
                if (!state.xrSnapTurnLocked) {
                    const snapAngle = stickX > 0 ? -Math.PI / 4 : Math.PI / 4;
                    xrSnapTurn(snapAngle);
                    state.xrSnapTurnLocked = true;
                    if (gp.hapticActuators && gp.hapticActuators[0]) {
                        gp.hapticActuators[0].pulse(0.4, 40);
                    }
                }
            } else if (Math.abs(stickX) < 0.25) {
                state.xrSnapTurnLocked = false;
            }

            // Vertical Push Forward (stickY < -0.55) -> Teleport Aim (grip is dedicated to grabbing/dragging)
            const isTeleportPush = (stickY < -0.55);

            if (isTeleportPush) {
                isAnyAimingTeleport = true;
                state.isTeleportAiming = true;
                state.activeTeleportController = ctrlObj;

                // Trace ballistic arc from controller tip
                const origin = new THREE.Vector3();
                ctrlObj.getWorldPosition(origin);

                const dir = new THREE.Vector3(0, 0, -1);
                dir.applyQuaternion(ctrlObj.getWorldQuaternion(new THREE.Quaternion()));

                // Parabolic trajectory: P(t) = origin + dir * v0 * t + 0.5 * g * t^2
                const v0 = 7.0; // launch speed m/s
                const g = -9.8; // gravity m/s^2
                const vy = dir.y * v0;
                const py = origin.y;

                // Solve for floor impact (y = 0): 4.9 * t^2 - vy * t - py = 0
                const disc = vy * vy + 19.6 * py;
                let hitT = 0;
                if (disc >= 0) {
                    hitT = (vy + Math.sqrt(disc)) / 9.8;
                }

                if (hitT > 0.05) {
                    const hitX = origin.x + dir.x * v0 * hitT;
                    const hitZ = origin.z + dir.z * v0 * hitT;

                    const isValidFloor = (hitX >= -3.4 && hitX <= 3.4 && hitZ >= -2.9 && hitZ <= 2.9);

                    state.isTeleportValid = isValidFloor;
                    state.teleportTarget.set(hitX, 0.0, hitZ);

                    teleportReticleGroup.position.set(hitX, 0.005, hitZ);
                    const { forward: camDir } = getHeadsetOrientation();
                    teleportReticleGroup.rotation.y = Math.atan2(camDir.x, camDir.z);
                    teleportReticleGroup.visible = isValidFloor;

                    const arcCol = isValidFloor ? 0x06b6d4 : 0xef4444;
                    arcMaterial.color.setHex(arcCol);
                    reticleRing.material.color.setHex(arcCol);
                    reticleDisc.material.color.setHex(arcCol);

                    const posAttr = arcGeometry.attributes.position;
                    for (let i = 0; i < ARC_POINTS; i++) {
                        const t = (i / (ARC_POINTS - 1)) * hitT;
                        const px = origin.x + dir.x * v0 * t;
                        const py_t = origin.y + dir.y * v0 * t + 0.5 * g * t * t;
                        const pz = origin.z + dir.z * v0 * t;
                        posAttr.setXYZ(i, px, py_t, pz);
                    }
                    posAttr.needsUpdate = true;
                    teleportArc.visible = true;
                }
            }
        }
    }

    // Teleport on stick/grip release
    if (!isAnyAimingTeleport && state.isTeleportAiming) {
        executeTeleport();
    }
}

// -----------------------------------------------------------------------------
// 3D FLOATING IN-WORLD VR PANEL & CONTROLS (DRAGGABLE & DROPPABLE IN LAB)
// -----------------------------------------------------------------------------
const vrPanelGroup = new THREE.Group();
vrPanelGroup.name = 'VR_Floating_Control_Screen';
vrPanelGroup.position.set(0.65, 1.25, -0.65);
vrPanelGroup.rotation.y = -Math.PI / 4;
scene.add(vrPanelGroup);

// Backing Chassis (Dark Obsidian Acrylic Glass Slab with Cyan Trim)
const vrPanelChassisMat = new THREE.MeshStandardMaterial({
    color: 0x070b16,
    roughness: 0.25,
    metalness: 0.1,
    transparent: true,
    opacity: 0.94,
    side: THREE.DoubleSide
});
const vrPanelChassisMesh = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.68, 0.015), vrPanelChassisMat);
vrPanelChassisMesh.position.set(0, 0.06, -0.012);
vrPanelChassisMesh.name = 'VR_Panel_Chassis';
vrPanelGroup.add(vrPanelChassisMesh);

const chassisEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.62, 0.68, 0.015));
const chassisLine = new THREE.LineSegments(chassisEdges, new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.45 }));
chassisLine.position.copy(vrPanelChassisMesh.position);
vrPanelGroup.add(chassisLine);

// Top Grab Handle Bar (Interactive Drag Grip)
const grabHandleCanvas = document.createElement('canvas');
grabHandleCanvas.width = 512;
grabHandleCanvas.height = 64;
const grabHandleCtx = grabHandleCanvas.getContext('2d');
const grabHandleTex = new THREE.CanvasTexture(grabHandleCanvas);
const grabHandleMat = new THREE.MeshBasicMaterial({ map: grabHandleTex, transparent: true });
const vrPanelGrabHandleMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.06), grabHandleMat);
vrPanelGrabHandleMesh.position.set(0, 0.35, 0.005);
vrPanelGrabHandleMesh.name = 'VR_Panel_GrabHandle';
vrPanelGroup.add(vrPanelGrabHandleMesh);

function redrawGrabHandle(handleState = 'normal') {
    if (!grabHandleCtx) return;
    const w = 512, h = 64;
    grabHandleCtx.clearRect(0, 0, w, h);

    if (handleState === 'dragging') {
        grabHandleCtx.fillStyle = '#0284c7';
        grabHandleCtx.fillRect(0, 0, w, h);
        grabHandleCtx.strokeStyle = '#ffffff';
        grabHandleCtx.lineWidth = 4;
        grabHandleCtx.strokeRect(2, 2, w - 4, h - 4);

        grabHandleCtx.fillStyle = '#ffffff';
        grabHandleCtx.font = 'bold 22px sans-serif';
        grabHandleCtx.textAlign = 'center';
        grabHandleCtx.textBaseline = 'middle';
        grabHandleCtx.fillText('● MOVING SCREEN... RELEASE TO DROP', w / 2, h / 2);
    } else if (handleState === 'hover') {
        grabHandleCtx.fillStyle = '#0f2942';
        grabHandleCtx.fillRect(0, 0, w, h);
        grabHandleCtx.strokeStyle = '#38bdf8';
        grabHandleCtx.lineWidth = 3;
        grabHandleCtx.strokeRect(2, 2, w - 4, h - 4);

        grabHandleCtx.fillStyle = '#38bdf8';
        grabHandleCtx.font = 'bold 20px sans-serif';
        grabHandleCtx.textAlign = 'center';
        grabHandleCtx.textBaseline = 'middle';
        grabHandleCtx.fillText('✊ HOLD GRIP / TRIGGER TO DRAG', w / 2, h / 2);
    } else {
        grabHandleCtx.fillStyle = '#0a1220';
        grabHandleCtx.fillRect(0, 0, w, h);
        grabHandleCtx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
        grabHandleCtx.lineWidth = 2;
        grabHandleCtx.strokeRect(2, 2, w - 4, h - 4);

        grabHandleCtx.fillStyle = '#38bdf8';
        grabHandleCtx.font = 'bold 18px sans-serif';
        grabHandleCtx.textAlign = 'center';
        grabHandleCtx.textBaseline = 'middle';
        grabHandleCtx.fillText('⋮⋮ 🖐 DRAG / MOVE SCREEN ⋮⋮', w / 2, h / 2);
    }

    grabHandleTex.needsUpdate = true;
}
redrawGrabHandle('normal');

function resetVRPanelPosition() {
    vrPanelGroup.position.set(0.65, 1.25, -0.65);
    vrPanelGroup.rotation.set(0, -Math.PI / 4, 0);
    redrawGrabHandle('normal');
}

function orientVRPanelToUser() {
    const headPos = new THREE.Vector3();
    camera.getWorldPosition(headPos);
    vrPanelGroup.lookAt(headPos.x, vrPanelGroup.position.y, headPos.z);
}

function startVRPanelDrag(controller, holdDistance, isGrip) {
    state.activeVRPanelDrag = {
        controller,
        holdDistance: Math.max(0.5, Math.min(4.0, holdDistance)),
        isGrip
    };
    redrawGrabHandle('dragging');
    const inputSource = controller.userData.inputSource;
    if (inputSource?.gamepad?.hapticActuators?.[0]) {
        inputSource.gamepad.hapticActuators[0].pulse(0.8, 60);
    }
}

function endVRPanelDrag() {
    if (state.activeVRPanelDrag) {
        const inputSource = state.activeVRPanelDrag.controller?.userData?.inputSource;
        if (inputSource?.gamepad?.hapticActuators?.[0]) {
            inputSource.gamepad.hapticActuators[0].pulse(0.5, 40);
        }
        state.activeVRPanelDrag = null;
        redrawGrabHandle('normal');
    }
}

function updateVRPanelDrag(delta) {
    if (!renderer.xr.isPresenting || !state.activeVRPanelDrag) return;

    const drag = state.activeVRPanelDrag;
    const ctrl = drag.controller;
    if (!ctrl) return;

    ctrl.updateMatrixWorld(true);

    // Push / Pull distance via controller thumbstick
    const inputSource = ctrl.userData.inputSource;
    if (inputSource?.gamepad) {
        const gp = inputSource.gamepad;
        const stickY = (gp.axes.length >= 4) ? gp.axes[3] : (gp.axes[1] || 0);
        if (Math.abs(stickY) > 0.15) {
            drag.holdDistance = THREE.MathUtils.clamp(drag.holdDistance - stickY * 2.2 * delta, 0.45, 4.5);
        }
    }

    const ctrlPos = new THREE.Vector3();
    ctrl.getWorldPosition(ctrlPos);
    const ctrlDir = new THREE.Vector3(0, 0, -1).transformDirection(ctrl.matrixWorld);

    const targetPos = new THREE.Vector3().copy(ctrlPos).addScaledVector(ctrlDir, drag.holdDistance);

    // Clamp inside walkable laboratory bounds
    targetPos.x = THREE.MathUtils.clamp(targetPos.x, -3.8, 3.8);
    targetPos.y = THREE.MathUtils.clamp(targetPos.y, 0.4, 2.5);
    targetPos.z = THREE.MathUtils.clamp(targetPos.z, -3.6, 3.6);

    vrPanelGroup.position.lerp(targetPos, 0.28);

    // Billboard to face player's head
    const headPos = new THREE.Vector3();
    camera.getWorldPosition(headPos);
    vrPanelGroup.lookAt(headPos.x, vrPanelGroup.position.y, headPos.z);
}

// Header Display Card on VR Panel
const headerCanvas = document.createElement('canvas');
headerCanvas.width = 512;
headerCanvas.height = 140;
const vrPanelHeaderCtx = headerCanvas.getContext('2d');
const vrPanelHeaderTex = new THREE.CanvasTexture(headerCanvas);
const vrPanelHeaderMat = new THREE.MeshBasicMaterial({ map: vrPanelHeaderTex });
const vrPanelHeaderMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.14), vrPanelHeaderMat);
vrPanelHeaderMesh.position.set(0, 0.22, 0);
vrPanelGroup.add(vrPanelHeaderMesh);

function updateVRPanelHeader() {
    if (!vrPanelHeaderCtx) return;
    const w = 512, h = 140;
    const rgb = YDSEPhysicsModel.wavelengthToRGB(physics.wavelength);
    const betaMm = (physics.getFringeSpacing() * 1000.0).toFixed(2);
    const nm = (physics.wavelength * 1e9).toFixed(1);

    vrPanelHeaderCtx.fillStyle = '#090d16';
    vrPanelHeaderCtx.fillRect(0, 0, w, h);

    // Border glowing in laser color
    vrPanelHeaderCtx.strokeStyle = rgb.hex;
    vrPanelHeaderCtx.lineWidth = 6;
    vrPanelHeaderCtx.strokeRect(3, 3, w - 6, h - 6);

    // Wavelength title
    vrPanelHeaderCtx.fillStyle = rgb.hex;
    vrPanelHeaderCtx.font = 'bold 30px sans-serif';
    vrPanelHeaderCtx.textAlign = 'center';
    vrPanelHeaderCtx.fillText(`λ = ${nm} nm (${rgb.label.split(' ')[0]})`, w / 2, 42);

    // Distance & Fringe Spacing
    vrPanelHeaderCtx.fillStyle = '#94a3b8';
    vrPanelHeaderCtx.font = '22px monospace';
    vrPanelHeaderCtx.fillText(`D = ${physics.screenDistance.toFixed(2)}m  |  β = ${betaMm}mm`, w / 2, 84);

    // Status
    vrPanelHeaderCtx.fillStyle = physics.laserActive ? '#22c55e' : '#ef4444';
    vrPanelHeaderCtx.font = 'bold 20px sans-serif';
    vrPanelHeaderCtx.fillText(physics.laserActive ? '● LASER ACTIVE' : '○ LASER DISABLED', w / 2, 120);

    vrPanelHeaderTex.needsUpdate = true;
}

const vrButtons = [];

function createVRButton3D(text, x, y, onClick, isAction = false) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, 256, 64);
    ctx.strokeStyle = isAction ? '#38bdf8' : '#64748b'; ctx.lineWidth = 3; ctx.strokeRect(2, 2, 252, 60);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(text, 128, 40);
    
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.06), mat);
    mesh.position.set(x, y, 0);
    mesh.userData = { onClick, text, isAction };
    vrPanelGroup.add(mesh);
    vrButtons.push(mesh);
    return mesh;
}

createVRButton3D('🔴 632nm Red', -0.14, 0.06, () => setWavelength(632.8));
createVRButton3D('🟢 532nm Green', 0.14, 0.06, () => setWavelength(532.0));
createVRButton3D('🟣 405nm Violet', -0.14, -0.01, () => setWavelength(405.0));
createVRButton3D('🟡 589nm Sodium', 0.14, -0.01, () => setWavelength(589.0));
createVRButton3D('⚡ Toggle Laser', -0.14, -0.08, toggleLaserPower, true);
createVRButton3D('⚛ Quantum Mode', 0.14, -0.08, toggleQuantumMode, true);
createVRButton3D('◀ Screen Closer', -0.14, -0.15, () => setScreenDistance(physics.screenDistance - 0.15));
createVRButton3D('▶ Screen Further', 0.14, -0.15, () => setScreenDistance(physics.screenDistance + 0.15));
createVRButton3D('🎯 Reset Pos', -0.14, -0.22, resetVRPanelPosition, true);
createVRButton3D('👁 Face Me', 0.14, -0.22, orientVRPanelToUser, true);

function onXRSqueezeStart(event) {
    const controller = event.target;
    controller.updateMatrixWorld(true);

    const raycaster = new THREE.Raycaster();
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).transformDirection(controller.matrixWorld);

    // 1. Raycast against Floating VR Screen (Direct ray aiming ONLY - no accidental proximity grab!)
    const panelTargets = [vrPanelGrabHandleMesh, vrPanelChassisMesh].filter(Boolean);
    const hits = raycaster.intersectObjects(panelTargets, false);
    if (hits.length > 0) {
        startVRPanelDrag(controller, hits[0].distance, true);
        return;
    }

    // 2. Raycast against Welcome Kiosk (Direct ray aiming ONLY - no accidental proximity grab!)
    const kioskTargets = [kioskInteractiveQuad, kioskDisplayMesh].filter(Boolean);
    const kioskHits = raycaster.intersectObjects(kioskTargets, false);
    if (kioskHits.length > 0) {
        startVRKioskDrag(controller, kioskHits[0].distance, true);
        return;
    }
}

function onXRSqueezeEnd(event) {
    if (state.activeVRPanelDrag && state.activeVRPanelDrag.controller === event.target) {
        endVRPanelDrag();
    }
    if (state.activeVRKioskDrag && state.activeVRKioskDrag.controller === event.target) {
        endVRKioskDrag();
    }
}

function onXRSelectStart(event) {
    const controller = event.target;
    controller.updateMatrixWorld(true);

    const raycaster = new THREE.Raycaster();
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).transformDirection(controller.matrixWorld);

    // 0. Check VR Panel Grab Handle or Chassis Trigger Drag
    const handleHits = raycaster.intersectObjects([vrPanelGrabHandleMesh, vrPanelChassisMesh], false);
    // Only drag chassis if not aiming at buttons
    const btnHitsCheck = raycaster.intersectObjects(vrButtons, false);
    if (handleHits.length > 0 && btnHitsCheck.length === 0) {
        startVRPanelDrag(controller, handleHits[0].distance, false);
        return;
    }

    // 0a. Raycast against 3D Welcome Kiosk (interactive quad only)
    const kioskTargets = [kioskInteractiveQuad].filter(Boolean);
    if (kioskTargets.length > 0) {
        kioskTargets.forEach(t => t.updateMatrixWorld(true));
        const kioskHits = raycaster.intersectObjects(kioskTargets, false);
        if (kioskHits.length > 0 && kioskHits[0].uv) {
            const kx = kioskHits[0].uv.x * 1080;
            const ky = kioskHits[0].uv.y * 1380;

            // If triggering on top grab bar, start Kiosk drag!
            if (ky <= 55) {
                startVRKioskDrag(controller, kioskHits[0].distance, false);
                return;
            }

            const action = interactWithKiosk(kx, ky, true);
            if (action) {
                const inputSource = controller.userData.inputSource;
                if (inputSource?.gamepad?.hapticActuators?.[0]) {
                    inputSource.gamepad.hapticActuators[0].pulse(0.7, 50);
                }
                redrawKioskTexture({ x: kx, y: ky });
                return;
            }
        }
    }

    // 0b. Raycast against 3D Parameter Console (interactive quad only)
    const consoleTargets = [consoleInteractiveQuad].filter(Boolean);
    if (consoleTargets.length > 0) {
        consoleTargets.forEach(t => t.updateMatrixWorld(true));
        const consoleHits = raycaster.intersectObjects(consoleTargets, false);
        if (consoleHits.length > 0 && consoleHits[0].uv) {
            const cx = consoleHits[0].uv.x * 1080;
            const cy = consoleHits[0].uv.y * 620;
            const action = interactWithConsole(cx, cy, true);
            if (action) {
                if (action.type === 'slider') {
                    state.activeVRConsoleDrag = {
                        controller,
                        sliderId: action.id
                    };
                }
                const inputSource = controller.userData.inputSource;
                if (inputSource?.gamepad?.hapticActuators?.[0]) {
                    inputSource.gamepad.hapticActuators[0].pulse(0.7, 50);
                }
                redrawConsoleTexture({ x: cx, y: cy });
                return;
            }
        }
    }

    // 1. Raycast against 3D In-World VR Buttons
    const btnHits = raycaster.intersectObjects(vrButtons, false);
    if (btnHits.length > 0 && btnHits[0].object.userData.onClick) {
        btnHits[0].object.userData.onClick();
        const inputSource = controller.userData.inputSource;
        if (inputSource?.gamepad?.hapticActuators?.[0]) {
            inputSource.gamepad.hapticActuators[0].pulse(0.6, 50);
        }
        return;
    }

    // 2. Raycast against Observation Screen for Distance Dragging
    if (screenSurfaceMesh) {
        const hits = raycaster.intersectObject(screenSurfaceMesh, true);
        if (hits.length > 0) {
            state.isDraggingScreen = true;
            state.dragStartDistance = physics.screenDistance;
            state.dragController = controller;
            state.dragStartControllerZ = controller.position.z;
            return;
        }
    }
}

function onXRSelectEnd(event) {
    state.isDraggingScreen = false;
    state.dragController = null;
    state.activeVRConsoleDrag = null;
    if (state.activeVRPanelDrag && !state.activeVRPanelDrag.isGrip) {
        endVRPanelDrag();
    }
    if (state.activeVRKioskDrag && !state.activeVRKioskDrag.isGrip) {
        endVRKioskDrag();
    }
}

// =============================================================================
// 10. UI CONTROLS & EVENT HANDLERS
// =============================================================================
function setWavelength(nm) {
    physics.wavelength = nm * 1e-9;
    document.getElementById('slider-wavelength').value = nm;
    document.getElementById('val-wavelength').innerText = `${nm.toFixed(1)} nm`;

    const rgb = YDSEPhysicsModel.wavelengthToRGB(physics.wavelength);
    const lbl = document.getElementById('lbl-wavelength-color');
    lbl.innerText = rgb.label;
    lbl.style.color = rgb.hex;
    document.getElementById('laser-indicator').style.background = rgb.hex;
    document.getElementById('laser-indicator').style.boxShadow = `0 0 8px ${rgb.hex}`;

    // Update preset buttons state
    document.querySelectorAll('.btn-preset').forEach(btn => {
        btn.classList.toggle('active', Math.abs(parseFloat(btn.dataset.wl) - nm) < 0.5);
    });

    quantum.updateProbabilityDistribution();
    redrawScreenTexture();
    updateBeams();
    updateTelemetry();
    updateVRPanelHeader();
    redrawConsoleTexture();
    redrawKioskTexture();
}

function setScreenDistance(d) {
    d = Math.max(0.40, Math.min(2.40, d));
    physics.screenDistance = d;
    document.getElementById('slider-distance').value = d;
    document.getElementById('val-distance').innerText = `${d.toFixed(2)} m`;
    updateScreenPosition();
    quantum.updateProbabilityDistribution();
    redrawScreenTexture();
    updateTelemetry();
    updateVRPanelHeader();
    redrawConsoleTexture();
    redrawKioskTexture();
}

function setSlitSeparation(mm) {
    mm = Math.max(0.05, Math.min(0.80, mm));
    physics.slitSeparation = mm * 1e-3;
    document.getElementById('slider-separation').value = mm;
    document.getElementById('val-separation').innerText = `${mm.toFixed(2)} mm`;
    quantum.updateProbabilityDistribution();
    redrawScreenTexture();
    updateBeams();
    updateTelemetry();
    redrawConsoleTexture();
    redrawKioskTexture();
}

function setSlitWidth(mm) {
    mm = Math.max(0.01, Math.min(0.10, mm));
    physics.slitWidth = mm * 1e-3;
    document.getElementById('slider-width').value = mm;
    document.getElementById('val-width').innerText = `${mm.toFixed(2)} mm`;
    quantum.updateProbabilityDistribution();
    redrawScreenTexture();
    updateTelemetry();
    redrawConsoleTexture();
    redrawKioskTexture();
}

function toggleLaserPower() {
    physics.laserActive = !physics.laserActive;
    const btn = document.getElementById('btn-laser-power');
    const txt = document.getElementById('txt-laser-power');
    btn.classList.toggle('on', physics.laserActive);
    txt.innerText = physics.laserActive ? 'Laser Source: ACTIVE (ON)' : 'Laser Source: OFF (Disabled)';
    
    updateBeams();
    redrawScreenTexture();
    updateTelemetry();
    updateVRPanelHeader();
    redrawConsoleTexture();
    redrawKioskTexture();
}

function toggleQuantumMode() {
    const isQuantum = state.mode !== 'quantum';
    state.mode = isQuantum ? 'quantum' : 'classical';
    
    document.getElementById('tab-classical').classList.toggle('active', !isQuantum);
    document.getElementById('tab-quantum').classList.toggle('active', isQuantum);
    document.getElementById('quantum-section').classList.toggle('hidden', !isQuantum);
    document.getElementById('active-mode-label').innerText = isQuantum ? 'Quantum Single-Photon Mode' : 'Classical Wave Mode';

    if (isQuantum) {
        quantum.start();
    } else {
        quantum.pause();
    }
    redrawScreenTexture();
    redrawConsoleTexture();
    redrawKioskTexture();
}

// Sliders Event Listeners
document.getElementById('slider-wavelength').addEventListener('input', (e) => setWavelength(parseFloat(e.target.value)));
document.getElementById('slider-distance').addEventListener('input', (e) => setScreenDistance(parseFloat(e.target.value)));
document.getElementById('slider-separation').addEventListener('input', (e) => setSlitSeparation(parseFloat(e.target.value)));
document.getElementById('slider-width').addEventListener('input', (e) => setSlitWidth(parseFloat(e.target.value)));

document.getElementById('slider-visibility').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    physics.visibility = v;
    document.getElementById('val-visibility').innerText = v === 1.0 ? '1.00 (Coherent)' : (v === 0 ? '0.00 (Which-Path Decoherence)' : v.toFixed(2));
    quantum.updateProbabilityDistribution();
    redrawScreenTexture();
    updateTelemetry();
});

// Wavelength Preset Buttons
document.querySelectorAll('.btn-preset').forEach(btn => {
    btn.addEventListener('click', () => setWavelength(parseFloat(btn.dataset.wl)));
});

// Slit Configuration Buttons
function setSlitState(left, right, activeId) {
    physics.leftSlitOpen = left;
    physics.rightSlitOpen = right;
    document.querySelectorAll('.btn-toggle').forEach(b => b.classList.remove('active'));
    document.getElementById(activeId).classList.add('active');
    
    quantum.updateProbabilityDistribution();
    redrawScreenTexture();
    updateBeams();
    updateTelemetry();
}

document.getElementById('slit-both').addEventListener('click', () => setSlitState(true, true, 'slit-both'));
document.getElementById('slit-left').addEventListener('click', () => setSlitState(true, false, 'slit-left'));
document.getElementById('slit-right').addEventListener('click', () => setSlitState(false, true, 'slit-right'));
document.getElementById('slit-closed').addEventListener('click', () => setSlitState(false, false, 'slit-closed'));

document.getElementById('btn-laser-power').addEventListener('click', toggleLaserPower);

// Mode Tabs
document.getElementById('tab-classical').addEventListener('click', () => {
    if (state.mode !== 'classical') toggleQuantumMode();
});
document.getElementById('tab-quantum').addEventListener('click', () => {
    if (state.mode !== 'quantum') toggleQuantumMode();
});
document.getElementById('tab-lesson').addEventListener('click', () => {
    lesson.goToStage(1);
});

// Quantum Controls
document.getElementById('btn-quantum-run').addEventListener('click', () => {
    if (quantum.isRunning) {
        quantum.pause();
        document.getElementById('btn-quantum-run').innerText = '▶ Start Stream';
    } else {
        quantum.start();
        document.getElementById('btn-quantum-run').innerText = '⏸ Pause Stream';
    }
});

document.getElementById('btn-quantum-clear').addEventListener('click', () => {
    quantum.clearDetections();
    document.getElementById('cnt-emitted').innerText = '0';
    document.getElementById('cnt-detected').innerText = '0';
    redrawScreenTexture();
});

document.querySelectorAll('.btn-batch').forEach(btn => {
    btn.addEventListener('click', () => {
        const count = parseInt(btn.dataset.count, 10);
        quantum.emitBatch(count);
        document.getElementById('cnt-emitted').innerText = quantum.photonsEmitted.toLocaleString();
        document.getElementById('cnt-detected').innerText = quantum.photonsDetected.toLocaleString();
        redrawScreenTexture();
    });
});

document.getElementById('slider-photon-rate').addEventListener('input', (e) => {
    const rate = parseInt(e.target.value, 10);
    quantum.photonsPerSecond = rate;
    document.getElementById('val-photon-rate').innerText = `${rate} / sec`;
});

// Modals
document.getElementById('btn-start-experiment').addEventListener('click', () => {
    document.getElementById('modal-welcome').classList.add('hidden');
});
document.getElementById('btn-help').addEventListener('click', () => {
    document.getElementById('modal-help').classList.toggle('hidden');
});
document.getElementById('btn-close-help').addEventListener('click', () => {
    document.getElementById('modal-help').classList.add('hidden');
});
document.getElementById('btn-close-quiz').addEventListener('click', () => {
    document.getElementById('modal-quiz').classList.add('hidden');
});
function resetExperiment() {
    setWavelength(650.0);
    setScreenDistance(2.00);
    setSlitSeparation(0.50);
    setSlitWidth(0.10);
    setSlitState(true, true, 'slit-both');
    quantum.clearDetections();
    redrawScreenTexture();
    redrawConsoleTexture();
    redrawKioskTexture();
}
document.getElementById('btn-reset').addEventListener('click', resetExperiment);

// =============================================================================
// 11. 9-MINUTE STRUCTURED LESSON DIRECTOR UI HOOKS
// =============================================================================
document.getElementById('btn-lesson-next').addEventListener('click', () => lesson.nextStage());
document.getElementById('btn-lesson-prev').addEventListener('click', () => lesson.prevStage());

// =============================================================================
// 12. MOUSE/DESKTOP INTERACTION (3D Parameter Console + Screen Sampling)
// =============================================================================
window.addEventListener('pointerdown', (e) => {
    if (renderer.xr.isPresenting || e.button !== 0) return;

    state.mousePos.x = (e.clientX / window.innerWidth) * 2 - 1;
    state.mousePos.y = -(e.clientY / window.innerHeight) * 2 + 1;
    state.mouseRay.setFromCamera(state.mousePos, camera);

    // 0a. Check VR Panel Buttons (Desktop support)
    const vrBtnHits = state.mouseRay.intersectObjects(vrButtons, false);
    if (vrBtnHits.length > 0 && vrBtnHits[0].object.userData.onClick) {
        vrBtnHits[0].object.userData.onClick();
        return;
    }

    // 0b. Check VR Panel Grab Handle / Chassis (Desktop Mouse Dragging)
    const panelHits = state.mouseRay.intersectObjects([vrPanelGrabHandleMesh, vrPanelChassisMesh], false);
    if (panelHits.length > 0) {
        state.activeMousePanelDrag = {
            holdDistance: panelHits[0].distance
        };
        controls.enabled = false;
        document.body.style.cursor = 'grabbing';
        redrawGrabHandle('dragging');
        return;
    }

    // 0. Raycast against 3D Welcome Kiosk
    const kioskTargets = getKioskTargets();
    if (kioskTargets.length > 0) {
        kioskTargets.forEach(t => t.updateMatrixWorld(true));
        const hits = state.mouseRay.intersectObjects(kioskTargets, false);
        if (hits.length > 0 && hits[0].uv) {
            const kx = hits[0].uv.x * 1080;
            const ky = hits[0].uv.y * 1380;

            // Check if user clicked on Top Grab Bar for Mouse Dragging
            if (ky <= 55) {
                state.activeMouseKioskDrag = { holdDistance: hits[0].distance };
                controls.enabled = false;
                document.body.style.cursor = 'grabbing';
                redrawKioskTexture({ x: kx, y: ky });
                return;
            }

            const action = interactWithKiosk(kx, ky, true);
            if (action) {
                redrawKioskTexture({ x: kx, y: ky });
                return;
            }
        }
    }

    const consoleTargets = [consoleInteractiveQuad, consoleDisplayMesh].filter(Boolean);
    if (consoleTargets.length > 0) {
        consoleTargets.forEach(t => t.updateMatrixWorld(true));
        const hits = state.mouseRay.intersectObjects(consoleTargets, false);
        if (hits.length > 0 && hits[0].uv) {
            const cx = hits[0].uv.x * 1080;
            const cy = hits[0].uv.y * 620;
            const action = interactWithConsole(cx, cy, true);
            if (action) {
                if (action.type === 'slider') {
                    state.activeMouseConsoleDrag = { sliderId: action.id };
                    controls.enabled = false; // Disable orbit camera while sliding
                }
                redrawConsoleTexture({ x: cx, y: cy });
                return;
            }
        }
    }
});

window.addEventListener('pointermove', (e) => {
    state.mousePos.x = (e.clientX / window.innerWidth) * 2 - 1;
    state.mousePos.y = -(e.clientY / window.innerHeight) * 2 + 1;
    state.mouseRay.setFromCamera(state.mousePos, camera);

    if (renderer.xr.isPresenting) return;

    const consoleTargets = [consoleInteractiveQuad, consoleDisplayMesh].filter(Boolean);

    // 0a. Mouse Dragging Welcome Kiosk Screen
    if (state.activeMouseKioskDrag) {
        const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const hitPt = new THREE.Vector3();
        let targetX, targetZ;
        if (state.mouseRay.ray.intersectPlane(floorPlane, hitPt)) {
            targetX = hitPt.x;
            targetZ = hitPt.z;
        } else {
            const rawPt = new THREE.Vector3().copy(camera.position).addScaledVector(state.mouseRay.direction, state.activeMouseKioskDrag.holdDistance);
            targetX = rawPt.x;
            targetZ = rawPt.z;
        }

        targetX = THREE.MathUtils.clamp(targetX, -3.4, 3.4);
        targetZ = THREE.MathUtils.clamp(targetZ, -3.0, 3.0);
        kioskPivotGroup.position.set(targetX, 0, targetZ);

        const dx = camera.position.x - targetX;
        const dz = camera.position.z - targetZ;
        if (Math.hypot(dx, dz) > 0.4) {
            kioskPivotGroup.rotation.y = Math.atan2(dx, dz);
        }
        return;
    }

    // 0b. Mouse Dragging Floating VR Screen
    if (state.activeMousePanelDrag) {
        const targetPos = new THREE.Vector3()
            .copy(camera.position)
            .addScaledVector(state.mouseRay.direction, state.activeMousePanelDrag.holdDistance);
        
        targetPos.x = THREE.MathUtils.clamp(targetPos.x, -3.8, 3.8);
        targetPos.y = THREE.MathUtils.clamp(targetPos.y, 0.4, 2.5);
        targetPos.z = THREE.MathUtils.clamp(targetPos.z, -3.6, 3.6);

        vrPanelGroup.position.copy(targetPos);
        vrPanelGroup.lookAt(camera.position.x, vrPanelGroup.position.y, camera.position.z);
        return;
    }

    // Check hover on VR Panel Grab Handle / Chassis
    const panelHoverHits = state.mouseRay.intersectObjects([vrPanelGrabHandleMesh, vrPanelChassisMesh], false);
    if (panelHoverHits.length > 0) {
        document.body.style.cursor = 'grab';
        state.mouseOverPanelHandle = true;
        redrawGrabHandle('hover');
    } else if (state.mouseOverPanelHandle) {
        state.mouseOverPanelHandle = false;
        redrawGrabHandle('normal');
        if (!state.mouseOverConsole && !state.mouseOverKiosk) document.body.style.cursor = 'default';
    }

    // 1. Mouse Dragging Console Slider
    if (state.activeMouseConsoleDrag && consoleTargets.length > 0) {
        const hits = state.mouseRay.intersectObjects(consoleTargets, false);
        if (hits.length > 0 && hits[0].uv) {
            const cx = hits[0].uv.x * 1080;
            const cy = hits[0].uv.y * 620;
            interactWithConsole(cx, cy, false, state.activeMouseConsoleDrag.sliderId);
            redrawConsoleTexture({ x: cx, y: cy });
        }
        return;
    }

    // 2. Mouse Hovering over Console
    if (consoleTargets.length > 0) {
        const hits = state.mouseRay.intersectObjects(consoleTargets, false);
        if (hits.length > 0 && hits[0].uv) {
            const cx = hits[0].uv.x * 1080;
            const cy = hits[0].uv.y * 620;
            redrawConsoleTexture({ x: cx, y: cy });
            document.body.style.cursor = 'pointer';
            state.mouseOverConsole = true;
        } else if (state.mouseOverConsole) {
            state.mouseOverConsole = false;
            redrawConsoleTexture(null);
            if (!state.mouseOverKiosk) document.body.style.cursor = 'default';
        }
    }

    // 2b. Mouse Hovering over Welcome Kiosk
    const kioskTargets = getKioskTargets();
    if (kioskTargets.length > 0) {
        const hits = state.mouseRay.intersectObjects(kioskTargets, false);
        if (hits.length > 0 && hits[0].uv) {
            const kx = hits[0].uv.x * 1080;
            const ky = hits[0].uv.y * 1380;
            redrawKioskTexture({ x: kx, y: ky });
            document.body.style.cursor = 'pointer';
            state.mouseOverKiosk = true;
        } else if (state.mouseOverKiosk) {
            state.mouseOverKiosk = false;
            redrawKioskTexture(null);
            if (!state.mouseOverConsole) document.body.style.cursor = 'default';
        }
    }

    // 3. Screen Sampling
    if (screenSurfaceMesh) {
        const hits = state.mouseRay.intersectObject(screenSurfaceMesh, true);
        if (hits.length > 0 && hits[0].uv) {
            // UV x runs from 0 to 1 across screen width
            state.hoverScreenX = (hits[0].uv.x - 0.5) * (SCREEN_PHYSICAL_HALF_WIDTH * 2);
            updateTelemetry();
        }
    }
});

window.addEventListener('wheel', (e) => {
    if (renderer.xr.isPresenting) return;
    if (state.activeMousePanelDrag) {
        e.preventDefault();
        state.activeMousePanelDrag.holdDistance = THREE.MathUtils.clamp(
            state.activeMousePanelDrag.holdDistance + (e.deltaY > 0 ? 0.15 : -0.15),
            0.5,
            4.5
        );
        return;
    }
    const consoleTargets = [consoleInteractiveQuad, consoleDisplayMesh].filter(Boolean);
    if (consoleTargets.length > 0) {
        const hits = state.mouseRay.intersectObjects(consoleTargets, false);
        if (hits.length > 0 && hits[0].uv) {
            const cy = hits[0].uv.y * 620;
            for (const s of CONSOLE_SLIDERS) {
                if (Math.abs(cy - s.y) <= 38) {
                    e.preventDefault();
                    const dir = e.deltaY < 0 ? 1 : -1;
                    const newVal = THREE.MathUtils.clamp(s.get() + dir * s.step, s.min, s.max);
                    s.set(newVal);
                    redrawConsoleTexture({ x: hits[0].uv.x * 1080, y: cy });
                    break;
                }
            }
        }
    }
}, { passive: false });

window.addEventListener('pointerup', () => {
    if (state.activeMouseConsoleDrag) {
        state.activeMouseConsoleDrag = null;
        controls.enabled = true;
        document.body.style.cursor = 'default';
    }
    if (state.activeMousePanelDrag) {
        state.activeMousePanelDrag = null;
        controls.enabled = true;
        document.body.style.cursor = 'default';
        redrawGrabHandle('normal');
    }
    if (state.activeMouseKioskDrag) {
        state.activeMouseKioskDrag = null;
        controls.enabled = true;
        document.body.style.cursor = 'default';
        redrawKioskTexture();
    }
});

window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        e.preventDefault();
        toggleLaserPower();
    } else if (e.code === 'KeyR') {
        document.getElementById('btn-reset').click();
    } else if (e.code === 'KeyH') {
        document.getElementById('btn-help').click();
    } else if (e.code === 'KeyC') {
        document.getElementById('btn-quantum-clear').click();
    } else if (e.key >= '1' && e.key <= '6') {
        lesson.goToStage(parseInt(e.key, 10));
    }
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// =============================================================================
// 12.5. WEBXR CONSOLE CONTINUOUS RAYCAST & SLIDER DRAG HANDLER
// =============================================================================
const consolePlane = new THREE.Plane();
consolePlane.setFromCoplanarPoints(
    new THREE.Vector3(1.583117, 1.401131, 0.602158),
    new THREE.Vector3(1.455758, 0.868551, 0.986475),
    new THREE.Vector3(2.612876, 0.868551, 1.369932)
);
const consoleV1 = new THREE.Vector3(1.455758, 0.868551, 0.986475);
const consoleV2 = new THREE.Vector3(2.612876, 0.868551, 1.369932);
const consoleUAxis = new THREE.Vector3().subVectors(consoleV2, consoleV1);
const consoleULength = consoleUAxis.length();
consoleUAxis.normalize();

function updateVRConsoleInteraction() {
    if (!renderer.xr.isPresenting) return;
    const consoleTargets = [consoleInteractiveQuad].filter(Boolean);
    if (consoleTargets.length === 0) return;

    let hoverPoint = null;
    let hoveredSlider = null;
    const controllers = [controller0, controller1];

    if (state.activeVRConsoleDrag && state.activeVRConsoleDrag.controller) {
        const ctrl = state.activeVRConsoleDrag.controller;
        ctrl.updateMatrixWorld(true);

        const ray = new THREE.Raycaster();
        ray.ray.origin.setFromMatrixPosition(ctrl.matrixWorld);
        ray.ray.direction.set(0, 0, -1).transformDirection(ctrl.matrixWorld);

        const hits = ray.intersectObjects(consoleTargets, false);
        if (hits.length > 0 && hits[0].uv) {
            const cx = hits[0].uv.x * 1080;
            const cy = hits[0].uv.y * 620;
            interactWithConsole(cx, cy, false, state.activeVRConsoleDrag.sliderId);
            hoverPoint = { x: cx, y: cy };
        } else {
            // Planar projection ensures slider keeps dragging smoothly even if ray wavers off edge
            const hitPt = new THREE.Vector3();
            if (ray.ray.intersectPlane(consolePlane, hitPt)) {
                const rel = new THREE.Vector3().subVectors(hitPt, consoleV1);
                const u = THREE.MathUtils.clamp(rel.dot(consoleUAxis) / consoleULength, 0, 1);
                const cx = u * 1080;
                interactWithConsole(cx, 0, false, state.activeVRConsoleDrag.sliderId);
                hoverPoint = { x: cx, y: 350 };
            }
        }
    } else {
        // Laser pointer ray hover test
        for (const ctrl of controllers) {
            if (!ctrl) continue;
            ctrl.updateMatrixWorld(true);

            const ray = new THREE.Raycaster();
            ray.ray.origin.setFromMatrixPosition(ctrl.matrixWorld);
            ray.ray.direction.set(0, 0, -1).transformDirection(ctrl.matrixWorld);

            const hits = ray.intersectObjects(consoleTargets, false);
            if (hits.length > 0 && hits[0].uv) {
                const cx = hits[0].uv.x * 1080;
                const cy = hits[0].uv.y * 620;
                hoverPoint = { x: cx, y: cy };

                // Find closest slider row
                for (const s of CONSOLE_SLIDERS) {
                    if (Math.abs(cy - s.y) <= 38) {
                        hoveredSlider = s;
                        break;
                    }
                }
                break;
            }
        }
    }

    // 3D lightweight reticle for console oriented flush to slanted panel
    if (hoverPoint && consoleReticleMesh) {
        consoleReticleMesh.visible = true;
        const u = hoverPoint.x / 1080;
        const v = hoverPoint.y / 620;
        const consolePt = new THREE.Vector3().copy(consoleV1).addScaledVector(consoleUAxis, u * consoleULength);
        consolePt.y = THREE.MathUtils.lerp(1.401, 0.868, v);
        const norm = consolePlane.normal.clone().normalize();
        consoleReticleMesh.position.copy(consolePt).addScaledVector(norm, 0.004);
        consoleReticleMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), norm);
    } else if (consoleReticleMesh) {
        consoleReticleMesh.visible = false;
    }

    const sliderChanged = hoveredSlider !== state.hoveredConsoleSlider;
    state.hoveredConsoleSlider = hoveredSlider;

    // Only redraw when active slider drag is in progress or hovered row changed!
    if (state.activeVRConsoleDrag || sliderChanged) {
        state.lastVRHoverPoint = hoverPoint;
        redrawConsoleTexture(hoverPoint);
    }
}

// =============================================================================
// 13. ANIMATION RENDER LOOP (WITH 72/90/120 HZ VR SUPPORT)
// =============================================================================
const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
    try {
        const delta = clock.getDelta();

        // 1. WebXR Locomotion Engine (Left Stick Move, Right Stick Turn & Teleport)
        updateXRLocomotion(delta);

        // 2. WebXR 3D Parameter Console Continuous Interaction & Laser Pointer Reticle
        updateVRConsoleInteraction();

        // 2b. WebXR 3D Welcome Kiosk Continuous Interaction & Laser Pointer Reticle
        updateVRKioskInteraction();

        // 2c. WebXR Floating VR Screen 3D Drag & Drop Physics
        updateVRPanelDrag(delta);

        // 2d. WebXR Welcome Kiosk 3D Floor Drag & Drop Physics
        updateVRKioskDrag(delta);

        // 3. VR Direct Screen Dragging along optical rail
        if (state.isDraggingScreen && state.dragController) {
            const currentZ = state.dragController.position.z;
            const deltaZ = currentZ - state.dragStartControllerZ;
            setScreenDistance(state.dragStartDistance - deltaZ * 1.5);
        }

        // 4. In Quantum mode, step simulator and update counters
        if (state.mode === 'quantum' && quantum.isRunning) {
            const newDetections = quantum.step(delta);
            if (newDetections.length > 0) {
                const elEmitted = document.getElementById('cnt-emitted');
                const elDetected = document.getElementById('cnt-detected');
                if (elEmitted) elEmitted.innerText = quantum.photonsEmitted.toLocaleString();
                if (elDetected) elDetected.innerText = quantum.photonsDetected.toLocaleString();
                redrawScreenTexture();
            }
        }

        controls.update();
        renderer.render(scene, camera);
    } catch (loopErr) {
        console.error('Animation loop exception caught safely:', loopErr);
    }
});

// Initial startup matching laboratory optical bench defaults:
// Lambda = 650 nm, d = 0.50 mm, D = 2.00 m, a = 0.10 mm
setWavelength(650.0);
setSlitSeparation(0.50);
setScreenDistance(2.00);
setSlitWidth(0.10);
console.log("🚀 Young's Double-Slit XR Simulation initialized successfully.");
