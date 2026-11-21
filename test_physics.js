/**
 * Automated Scientific Verification Tests for Young's Double-Slit Experiment Simulation.
 * Covers requirements Test A through Test I from the scientific specification.
 */

const YDSEPhysicsModel = require('./ydse_physics.js');
const YDSEQuantumSimulator = require('./ydse_quantum.js');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
    totalTests++;
    if (!condition) {
        console.error(`❌ FAIL: ${message}`);
        throw new Error(message);
    } else {
        console.log(`✅ PASS: ${message}`);
        passedTests++;
    }
}

function assertClose(actual, expected, tolerance, message) {
    totalTests++;
    const diff = Math.abs(actual - expected);
    if (diff > tolerance) {
        console.error(`❌ FAIL: ${message} (Expected ${expected}, got ${actual}, diff ${diff} > ${tolerance})`);
        throw new Error(`${message}: Expected ${expected}, got ${actual}`);
    } else {
        console.log(`✅ PASS: ${message} (${actual.toFixed(6)} ≈ ${expected.toFixed(6)})`);
        passedTests++;
    }
}

console.log("=================================================");
console.log("  YDSE SCIENTIFIC PHYSICS ENGINE AUTOMATED TESTS  ");
console.log("=================================================\n");

// TEST A: Fringe Spacing at 1m and 2m
console.log("--- Test A: Fringe Spacing Scaling ---");
const modelA = new YDSEPhysicsModel({
    wavelength: 600e-9,      // 600 nm
    slitSeparation: 0.5e-3,  // 0.5 mm
    screenDistance: 1.0      // 1.0 m
});
// Expected beta = (600e-9 * 1.0) / 0.5e-3 = 1.2 mm = 0.0012 m
const beta1 = modelA.getFringeSpacing();
assertClose(beta1, 0.0012, 1e-7, "Fringe spacing at D = 1.0m must equal 1.2 mm");

modelA.screenDistance = 2.0;
// Expected beta = (600e-9 * 2.0) / 0.5e-3 = 2.4 mm = 0.0024 m
const beta2 = modelA.getFringeSpacing();
assertClose(beta2, 0.0024, 1e-7, "Fringe spacing at D = 2.0m must equal 2.4 mm");

// TEST B: Wavelength Variation
console.log("\n--- Test B: Wavelength Dependency ---");
modelA.screenDistance = 1.0;
modelA.wavelength = 400e-9;
const betaViolet = modelA.getFringeSpacing();
modelA.wavelength = 700e-9;
const betaRed = modelA.getFringeSpacing();
assert(betaRed > betaViolet, "Increasing wavelength must increase fringe spacing (Red > Violet)");
assertClose(betaRed / betaViolet, 700 / 400, 1e-4, "Fringe spacing ratio must exactly match wavelength ratio (7/4 = 1.75)");

// TEST C: Slit Separation Variation
console.log("\n--- Test C: Slit Separation Dependency ---");
modelA.slitSeparation = 0.2e-3;
const betaNarrow = modelA.getFringeSpacing();
modelA.slitSeparation = 0.8e-3;
const betaWide = modelA.getFringeSpacing();
assert(betaNarrow > betaWide, "Increasing slit separation must decrease fringe spacing");
assertClose(betaNarrow / betaWide, 0.8 / 0.2, 1e-4, "Fringe spacing inverse ratio must match separation ratio (4.0)");

// TEST D: Single Slit Diffraction
console.log("\n--- Test D: Single Slit Behavior ---");
const modelD = new YDSEPhysicsModel({
    wavelength: 632.8e-9,
    slitSeparation: 0.2e-3,
    slitWidth: 0.04e-3,
    screenDistance: 1.0,
    leftSlitOpen: true,
    rightSlitOpen: false
});

// Single slit intensity must have single central diffraction peak, no fast cosine interference oscillation
const iCenter = modelD.calculateIntensity(0.0);
assert(iCenter > 0, "Single slit intensity at center must be positive");
// Compare with both slits open
modelD.rightSlitOpen = true;
const iBothCenter = modelD.calculateIntensity(0.0);
assertClose(iBothCenter, 1.0, 1e-4, "Two coherent slits constructive peak normalized to 1.0");
modelD.rightSlitOpen = false;
assertClose(modelD.calculateIntensity(0.0), 0.25, 0.05, "Single slit transmission peak is ~0.25 of constructive two-slit peak");

// Verify that for single slit, first destructive fringe appears at x = lambda * D / a
const xMinDiffraction = (modelD.wavelength * modelD.screenDistance) / modelD.slitWidth;
const iMin = modelD.calculateIntensity(xMinDiffraction);
assertClose(iMin, 0.0, 1e-4, "Single slit first diffraction minimum must occur at x = lambda * D / a");

// TEST E: Both Slits Closed
console.log("\n--- Test E: Both Slits Closed ---");
const modelE = new YDSEPhysicsModel({
    leftSlitOpen: false,
    rightSlitOpen: false
});
assertClose(modelE.calculateIntensity(0.0), 0.0, 1e-9, "Center intensity must be 0 when both slits closed");
assertClose(modelE.calculateIntensity(0.005), 0.0, 1e-9, "Off-center intensity must be 0 when both slits closed");

const simE = new YDSEQuantumSimulator(modelE);
const detE = simE.emitBatch(100);
assert(detE.length === 0, "No photons can be detected when both slits are closed");
assert(simE.photonsEmitted === 100, "Emitted counter must track attempts even when blocked");
assert(simE.photonsDetected === 0, "Detected counter must remain 0 when blocked");

// TEST F: Finite Slit Width Diffraction Envelope
console.log("\n--- Test F: Finite Slit Width Envelope ---");
const modelF = new YDSEPhysicsModel({
    wavelength: 500e-9,
    slitSeparation: 0.5e-3,
    slitWidth: 0.1e-3,
    screenDistance: 1.0,
    leftSlitOpen: true,
    rightSlitOpen: true
});
// When slit width a = 0.1mm, d/a = 5, so the 5th interference fringe coincides with the 1st diffraction minimum (missing order)
const xFringe5 = 5 * (modelF.wavelength * modelF.screenDistance / modelF.slitSeparation);
const iMissingOrder = modelF.calculateIntensity(xFringe5);
assertClose(iMissingOrder, 0.0, 1e-3, "Missing order: 5th interference peak must be suppressed by diffraction envelope sinc^2");

// TEST G: Quantum Photon Statistics & Sampling
console.log("\n--- Test G: Single-Photon Statistical Sampling ---");
const modelG = new YDSEPhysicsModel({
    wavelength: 632.8e-9,
    slitSeparation: 0.2e-3,
    slitWidth: 0.04e-3,
    screenDistance: 1.0
});
const simG = new YDSEQuantumSimulator(modelG, { screenWidth: 0.10, numBins: 50 });
simG.emitBatch(5000);
assert(simG.photonsDetected === 5000, "5000 photons must be detected when slits are open");

const comparison = simG.getHistogramComparison();
let correlationSum = 0;
let theoSum = 0;
let obsSum = 0;
for (const bin of comparison.bins) {
    correlationSum += bin.normalizedObserved * bin.normalizedTheoretical;
    theoSum += bin.normalizedTheoretical * bin.normalizedTheoretical;
    obsSum += bin.normalizedObserved * bin.normalizedObserved;
}
const correlation = correlationSum / (Math.sqrt(theoSum) * Math.sqrt(obsSum));
assert(correlation > 0.85, `Empirical photon histogram must correlate with theoretical intensity (Correlation: ${correlation.toFixed(3)} > 0.85)`);

// TEST H: Exact Path Difference & Geometry
console.log("\n--- Test H: Geometric Path Difference Symmetry ---");
const pathDiffPos = modelG.getPathDifference(0.003);
const pathDiffNeg = modelG.getPathDifference(-0.003);
assertClose(pathDiffPos, pathDiffNeg, 1e-12, "Path difference must be symmetric about central optical axis");
assertClose(modelG.getPathDifference(0.0), 0.0, 1e-12, "Path difference at center x = 0 must be exactly zero");

// TEST I: Wavelength to RGB Conversion
console.log("\n--- Test I: Spectral Color Mapping ---");
const colorRed = YDSEPhysicsModel.wavelengthToRGB(632.8e-9);
assert(colorRed.r > 0.7 && colorRed.g < 0.2 && colorRed.b < 0.2, "632.8 nm must produce Red RGB");
assert(colorRed.isVisible === true, "632.8 nm is visible");

const colorGreen = YDSEPhysicsModel.wavelengthToRGB(532e-9);
assert(colorGreen.g > 0.8 && colorGreen.b < 0.2, "532 nm must produce Green RGB");

const colorUV = YDSEPhysicsModel.wavelengthToRGB(300e-9);
assert(colorUV.isVisible === false, "300 nm must be flagged as non-visible UV");

const colorIR = YDSEPhysicsModel.wavelengthToRGB(900e-9);
assert(colorIR.isVisible === false, "900 nm must be flagged as non-visible IR");

console.log("\n=================================================");
console.log(`  ALL ${passedTests}/${totalTests} TESTS PASSED SUCCESSFULLY!  `);
console.log("=================================================");
