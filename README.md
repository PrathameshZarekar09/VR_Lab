# Young’s Double-Slit Experiment (YDSE) XR Virtual Laboratory

An interactive, scientifically rigorous, cross-platform physics simulation of **Thomas Young’s Double-Slit Experiment (1801)** and **Wave-Particle Duality**. 

Engineered for school and university physics curricula, supporting three primary deployment targets:
1. **Meta Quest 3 & Meta Quest 3S**: Standalone immersive 6DOF VR with motion controller interaction and optional optical hand tracking.
2. **Laptop & Desktop PC**: Interactive 3D laboratory with intuitive mouse & keyboard orbit, first-person navigation, and draggable apparatus.
3. **Web Browser (Zero-Install)**: High-speed browser delivery via Three.js with full WebXR support.

---

## 🌟 Key Features & Architectural Highlights

### 1. Scientifically Validated SI-Unit Physics Engine (`ydse_physics.js` & `YDSEPhysicsModel.cs`)
- **Fringe Spacing Scaling**: Computes $\beta = \frac{\lambda D}{d}$ continuously with real-time screen recalculation.
- **Exact Geometric Path Difference**: Uses $\Delta r = |\sqrt{D^2 + (x + d/2)^2} - \sqrt{D^2 + (x - d/2)^2}|$ without small-angle visual distortion.
- **Phase Difference**: Calculates $\Delta\phi = \frac{2\pi\Delta r}{\lambda}$ with constructive/destructive classification.
- **Fraunhofer Diffraction Envelope**: Multiplies two-slit interference by finite slit width diffraction factor $\operatorname{sinc}^2\left(\frac{\pi a x}{\lambda D}\right)$.
- **Independent Slit States**:
  - **Both Open**: Symmetrical two-slit interference with diffraction envelope.
  - **Left Only**: Single-slit Fraunhofer diffraction centered on left slit ($-\frac{d}{2}$).
  - **Right Only**: Single-slit Fraunhofer diffraction centered on right slit ($+\frac{d}{2}$).
  - **Both Closed**: Complete transmission blockage ($I(x) = 0$, zero new detections).
- **Quantum Which-Path / Coherence Mode**: Continuous visibility parameter $V \in [0, 1]$ modeling distinguishability and decoherence.

### 2. Quantum Single-Photon Simulation (`ydse_quantum.js` & `PhotonDetectionSimulator.cs`)
- Genuine Monte Carlo rejection & CDF inverse transform sampling based on probability density $p(x) = \frac{I(x)}{\int I(x)dx}$.
- Discrete stochastic photon arrivals plotted on the screen phosphor face.
- Evolving empirical histogram demonstrating how classical interference fringes emerge from thousands of discrete quantum clicks.
- Emitted vs Detected photon counters, batch emission (+100, +1,000, +5,000), rate slider, and pause/clear controls.

### 3. Apparatus & Laboratory Environment
- Preserves the existing `3d model/Lab_Setup.glb` (26 structural nodes: Laser Source, Double Slit Carriage, Observation Screen, Optical Rail, Parameter Console, Welcome Kiosk, etc.).
- **Laser Emitter**: Selectable wavelength (He-Ne Red 632.8 nm, Argon Green 532 nm, Diode Violet 405 nm, Sodium Yellow 589 nm, UV 350 nm, IR 850 nm) with physically matched RGB spectrum rendering.
- **Movable Observation Screen**: Constrained sliding along the optical rail with clamped distance $D$ ($0.40\text{ m} \le D \le 2.50\text{ m}$) and live distance measurement.
- **Interactive Screen Probe**: Hover or click anywhere on the observation screen to sample position $x$, path difference $\Delta r$, phase difference $\Delta\phi$, and intensity percentage.
- **Horizontal Intensity Cross-Section**: Real-time oscilloscope-style $I(x)$ graph.

### 4. 9-Minute Structured Educational Curriculum (`lesson.js`)
- **Stage 1 (0:00–1:00)**: Welcome & Orientation (Apparatus identification, laser, slits, screen).
- **Stage 2 (1:00–2:15)**: Apparatus Exploration (Screen distance, wavelength, and fringe width).
- **Stage 3 (2:15–4:00)**: Physical Principles (Path difference, phase difference, constructive vs destructive interference).
- **Stage 4 (4:00–5:45)**: Parameter Experimentation & Predictions (Single slit toggles, slit separation variation).
- **Stage 5 (5:45–7:30)**: Quantum Single-Photon Mode (Wave-particle duality, statistical accumulation).
- **Stage 6 (7:30–9:00)**: Conclusion & Physics Quiz (5 interactive questions with scientific explanations and score tracking).

---

## 🚀 Quick Start & How to Run

### 1. WebXR / Browser / Desktop Version

#### Prerequisites
- Node.js v18+ installed.

#### Running the Local Server
From this project directory (`YDSE Final VR`):
```bash
# Start dual HTTPS and HTTP servers
npm start
# Or directly via node
node server.js
```

#### Accessing the Simulation:
- **Laptop / Desktop Browser**: Open `https://localhost:3443` or `http://localhost:3000`.
- **Meta Quest 3 / Quest 3S**:
  1. Connect your Quest headset to the same Wi-Fi network as your computer.
  2. Open the **Meta Quest Browser** inside the headset.
  3. Navigate to the HTTPS URL logged in the terminal (e.g. `https://<YOUR_IP>:3443`).
  4. Click the **"ENTER VR"** button on the top right.
  5. Put on controllers or use optical hand tracking.

---

## 🎮 Platform Interaction Guide

### 💻 Laptop / Desktop (Mouse & Keyboard)
| Control | Action |
| :--- | :--- |
| **Left Click + Drag** | Orbit 3D Laboratory Camera |
| **Right Click + Drag** | Pan Camera |
| **Mouse Scroll Wheel** | Zoom In / Out |
| **Hover on Screen** | Probe exact coordinate $x$, path difference $\Delta r$, phase difference $\Delta\phi$ |
| **Spacebar** | Toggle Laser Power (On / Off) |
| **R** | Reset Experiment to Default Parameters |
| **H** | Open / Close Help Dialog |
| **C** | Clear Single-Photon Detections |
| **1 – 6** | Jump directly to Lesson Stage 1 through 6 |

### 🥽 Meta Quest 3 & Meta Quest 3S
| VR Control | Action |
| :--- | :--- |
| **Left Joystick (Thumbstick)** | **Continuous Locomotion**: Smooth walk forward, backward, strafe left/right oriented to headset viewing yaw |
| **Right Joystick (Horizontal)** | **Snap Turn**: Instant 45° left/right rotation pivoted around player's head |
| **Right Joystick (Push Forward) / Grip** | **Parabolic Teleportation**: Ballistic arc and glowing cyan floor reticle; release stick to teleport to destination |
| **Controller Pointer Raycast** | Point at 3D floating in-world buttons and click trigger to select |
| **3D Floating Console** | In-world VR control panel displaying real-time wavelength badge (color-coded), laser toggle, screen distance, and quantum mode |
| **Screen Interaction** | Point ray at Observation Screen and hold trigger/grip to slide along optical rail |
| **Hand Tracking** | Natural pinch gesture triggers UI button activation and screen grabbing |
| **Oculus Menu Button** | Recenter view or pause session |

---

## 🧪 Automated Scientific Physics Tests

To run the automated physics validation test suite:
```bash
npm test
# Or directly:
node test_physics.js
```

### Verified Test Cases:
- **Test A — Fringe Spacing**: Verified $\beta = 1.20\text{ mm}$ at $D = 1.0\text{ m}$ and $\beta = 2.40\text{ mm}$ at $D = 2.0\text{ m}$ ($\lambda = 600\text{ nm}, d = 0.5\text{ mm}$).
- **Test B — Wavelength Dependence**: Verified $\beta_{\text{red}} / \beta_{\text{violet}} = 700 / 400 = 1.75$ scaling.
- **Test C — Slit Separation**: Verified inverse scaling $\beta \propto 1/d$.
- **Test D — Single-Slit Diffraction**: Verified transmission peak reduction to $0.25 I_0$ and first null at $x = \lambda D / a$.
- **Test E — Both Slits Closed**: Verified $I(x) = 0.0$ across the screen and 0 photon detections.
- **Test F — Finite Slit Width**: Verified missing orders where the 5th interference peak is extinguished by the $\operatorname{sinc}^2$ envelope.
- **Test G — Quantum Photon Statistics**: Verified 5,000 sampled photons correlate with theoretical intensity distribution ($r > 0.95$).
- **Test H — Geometric Path Difference Symmetry**: Verified $\Delta r(x) = \Delta r(-x)$ and $\Delta r(0) = 0$.
- **Test I — Spectral Color Mapping**: Verified 632.8 nm Red, 532 nm Green, non-visible UV flag, and non-visible IR flag.

---

## 📁 Project Structure

```
YDSE Final VR/
├── 3d model/
│   └── Lab_Setup.glb         # Full 26-node physics laboratory 3D model
├── node_modules/three/       # Three.js v0.185.1 library
├── cert.pem                  # SSL Certificate for WebXR Quest delivery
├── key.pem                   # SSL Private Key
├── index.html                # Responsive web application interface
├── style.css                 # Laboratory styling and glassmorphism UI
├── main.js                   # 3D WebXR rendering, apparatus control & input
├── ydse_physics.js           # Core SI-unit physical optics calculations
├── ydse_quantum.js           # Monte Carlo single-photon sampling engine
├── lesson.js                 # 9-minute educational lesson state machine
├── test_physics.js           # Automated scientific test runner
├── server.js                 # Dual HTTPS / HTTP server
├── package.json              # Project configuration and npm scripts
└── README.md                 # Complete documentation and user guide
```

---

## ⚙️ Build Status & Platform Notes

1. **Web Browser**: Fully verified and running at `http://localhost:3000` and `https://localhost:3443`.
2. **Desktop (Mouse & Keyboard)**: Fully verified with OrbitControls, interactive sliders, coordinate probes, and keyboard shortcuts.
3. **Meta Quest 3 / 3S Standalone (WebXR)**: Fully configured with OpenXR WebXR runtime, 6DOF controller rays, and hand tracking models via Meta Quest Browser over secure HTTPS.
4. **Unity XR Standalone Build**: Unity 6 C# scripts provided in `C:\Unity Projects\VR_Project_AG\Assets\YDSE_Lab\Scripts` with corresponding build scripts (`YDSEBuildScript.cs`) and FBX asset converted from `Lab_Setup.glb`.
