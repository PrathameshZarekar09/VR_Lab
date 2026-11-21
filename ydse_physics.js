/**
 * YDSEPhysicsModel.js
 * Scientifically accurate, modular Young's Double-Slit Experiment physics engine.
 * Strictly uses SI units internally (meters, seconds, radians).
 * Independent of rendering and platform-specific input.
 */

class YDSEPhysicsModel {
    constructor(config = {}) {
        // Physical parameters (SI units)
        this.wavelength = config.wavelength || 632.8e-9;      // m (default 632.8 nm He-Ne)
        this.slitSeparation = config.slitSeparation || 0.20e-3; // m (d = 0.20 mm)
        this.slitWidth = config.slitWidth || 0.04e-3;          // m (a = 0.04 mm)
        this.screenDistance = config.screenDistance || 1.20;    // m (D = 1.20 m)
        
        // Experimental state toggles
        this.laserActive = config.laserActive !== undefined ? config.laserActive : true;
        this.leftSlitOpen = config.leftSlitOpen !== undefined ? config.leftSlitOpen : true;
        this.rightSlitOpen = config.rightSlitOpen !== undefined ? config.rightSlitOpen : true;
        this.visibility = config.visibility !== undefined ? config.visibility : 1.0; // V in [0, 1] (coherence / which-path)
        this.peakIntensity = config.peakIntensity || 1.0;      // I_0
    }

    /**
     * Fringe spacing beta under small-angle approximation:
     * beta = (lambda * D) / d
     * Returns fringe spacing in meters.
     */
    getFringeSpacing() {
        if (this.slitSeparation <= 1e-9) return 0;
        return (this.wavelength * this.screenDistance) / this.slitSeparation;
    }

    /**
     * Exact geometric path difference for a screen position x (measured from center axis):
     * r1 = sqrt(D^2 + (x - d/2)^2)
     * r2 = sqrt(D^2 + (x + d/2)^2)
     * delta_r = |r2 - r1|
     */
    getPathDifference(x) {
        const d_half = this.slitSeparation * 0.5;
        const r1 = Math.sqrt(this.screenDistance * this.screenDistance + (x - d_half) * (x - d_half));
        const r2 = Math.sqrt(this.screenDistance * this.screenDistance + (x + d_half) * (x + d_half));
        return Math.abs(r2 - r1);
    }

    /**
     * Small-angle path difference approximation: delta_r ~ |x * d / D|
     */
    getApproxPathDifference(x) {
        return Math.abs(x * this.slitSeparation / this.screenDistance);
    }

    /**
     * Phase difference delta_phi = (2 * pi * delta_r) / lambda
     */
    getPhaseDifference(x) {
        const deltaR = this.getPathDifference(x);
        return (2.0 * Math.PI * deltaR) / this.wavelength;
    }

    /**
     * Normalized sinc function: sinc(u) = sin(u) / u, with sinc(0) = 1.
     */
    static sinc(u) {
        if (Math.abs(u) < 1e-9) return 1.0;
        return Math.sin(u) / u;
    }

    /**
     * Single-slit diffraction envelope factor at coordinate x relative to slit center x_slit:
     * u = (pi * a * (x - x_slit)) / (lambda * D)
     * Envelope = sinc^2(u)
     */
    getDiffractionEnvelope(x, xSlit = 0.0) {
        if (this.slitWidth <= 1e-9) return 1.0;
        const u = (Math.PI * this.slitWidth * (x - xSlit)) / (this.wavelength * this.screenDistance);
        const s = YDSEPhysicsModel.sinc(u);
        return s * s;
    }

    /**
     * Calculates the optical intensity I(x) at screen position x.
     * Evaluates slit states, diffraction envelope, and interference visibility.
     */
    calculateIntensity(x) {
        if (!this.laserActive) return 0.0;
        if (!this.leftSlitOpen && !this.rightSlitOpen) return 0.0;

        const d_half = this.slitSeparation * 0.5;

        // CASE 1: Both slits open -> Two-slit interference modulated by single-slit diffraction
        if (this.leftSlitOpen && this.rightSlitOpen) {
            const deltaPhi = this.getPhaseDifference(x);
            const envelope = this.getDiffractionEnvelope(x, 0.0);
            
            // Two-field interference with visibility V:
            // I = (I0 / 2) * (1 + V * cos(deltaPhi)) * envelope
            // When V = 1: (1 + cos(phi)) / 2 = cos^2(phi / 2) -> matches standard I0 * cos^2(phi / 2)
            const interference = 0.5 * (1.0 + this.visibility * Math.cos(deltaPhi));
            return this.peakIntensity * interference * envelope;
        }

        // CASE 2: Left slit only -> Pure single-slit diffraction from left slit (no interference)
        if (this.leftSlitOpen && !this.rightSlitOpen) {
            const envelope = this.getDiffractionEnvelope(x, -d_half);
            // Single slit transmits 1/4 the peak constructive two-slit intensity
            return (this.peakIntensity * 0.25) * envelope;
        }

        // CASE 3: Right slit only -> Pure single-slit diffraction from right slit (no interference)
        if (!this.leftSlitOpen && this.rightSlitOpen) {
            const envelope = this.getDiffractionEnvelope(x, d_half);
            return (this.peakIntensity * 0.25) * envelope;
        }

        return 0.0;
    }

    /**
     * Inspects the point on the screen and returns a comprehensive scientific summary.
     */
    inspectScreenPosition(x) {
        const deltaR = this.getPathDifference(x);
        const deltaPhi = this.getPhaseDifference(x);
        const intensity = this.calculateIntensity(x);
        const fringeSpacing = this.getFringeSpacing();
        const order = fringeSpacing > 1e-9 ? Math.round(x / fringeSpacing) : 0;
        
        // Determine constructive or destructive interference
        const phaseMod2Pi = ((deltaPhi % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const isConstructive = Math.abs(phaseMod2Pi) < 0.25 || Math.abs(phaseMod2Pi - 2 * Math.PI) < 0.25;
        const isDestructive = Math.abs(phaseMod2Pi - Math.PI) < 0.25;

        let interferenceType = "Intermediate";
        if (isConstructive) interferenceType = "Constructive Maximum";
        else if (isDestructive) interferenceType = "Destructive Minimum";

        return {
            xPosition: x,
            xPositionMm: x * 1000.0,
            pathDifference: deltaR,
            pathDifferenceNm: deltaR * 1e9,
            phaseDifferenceRad: deltaPhi,
            phaseDifferenceDeg: (deltaPhi * 180.0) / Math.PI,
            intensity: intensity,
            normalizedIntensity: this.peakIntensity > 0 ? intensity / this.peakIntensity : 0,
            fringeOrder: order,
            interferenceType: interferenceType
        };
    }

    /**
     * Converts optical wavelength to approximate RGB color and visibility classification.
     */
    static wavelengthToRGB(wavelengthM) {
        const nm = wavelengthM * 1e9;
        let r = 0, g = 0, b = 0;
        let isVisible = true;
        let label = "";

        if (nm < 380) {
            // Ultraviolet (invisible to human eye; represented as dim fluorescent violet)
            isVisible = false;
            label = "Ultraviolet (UV - Non-visible)";
            r = 0.55; g = 0.15; b = 0.90;
        } else if (nm >= 380 && nm < 440) {
            const factor = 0.3 + 0.7 * (nm - 380) / (440 - 380);
            r = Math.pow((-(nm - 440) / (440 - 380)) * factor, 0.8);
            g = 0.0;
            b = Math.pow(factor, 0.8);
            label = "Violet (" + nm.toFixed(1) + " nm)";
        } else if (nm >= 440 && nm < 490) {
            r = 0.0;
            g = Math.pow((nm - 440) / (490 - 440), 0.8);
            b = 1.0;
            label = "Blue (" + nm.toFixed(1) + " nm)";
        } else if (nm >= 490 && nm < 510) {
            r = 0.0;
            g = 1.0;
            b = Math.pow(-(nm - 510) / (510 - 490), 0.8);
            label = "Cyan (" + nm.toFixed(1) + " nm)";
        } else if (nm >= 510 && nm < 570) {
            r = Math.pow((nm - 510) / (570 - 510), 0.8);
            g = 1.0;
            b = 0.0;
            label = "Green (" + nm.toFixed(1) + " nm)";
        } else if (nm >= 570 && nm < 620) {
            r = 1.0;
            g = Math.pow(-(nm - 620) / (620 - 570), 0.8);
            b = 0.0;
            label = "Yellow/Orange (" + nm.toFixed(1) + " nm)";
        } else if (nm >= 620 && nm <= 750) {
            let factor = 1.0;
            if (nm > 700) factor = 0.3 + 0.7 * (750 - nm) / (750 - 700);
            r = Math.pow(factor, 0.8);
            g = 0.0;
            b = 0.0;
            label = "Red (" + nm.toFixed(1) + " nm)";
        } else {
            // Infrared (invisible to human eye; represented as dark crimson indicator)
            isVisible = false;
            label = "Infrared (IR - Non-visible)";
            r = 0.65; g = 0.05; b = 0.05;
        }

        return {
            r: Math.min(1.0, Math.max(0.0, r)),
            g: Math.min(1.0, Math.max(0.0, g)),
            b: Math.min(1.0, Math.max(0.0, b)),
            hex: "#" + [r, g, b].map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join(""),
            isVisible: isVisible,
            label: label
        };
    }
}

// Support both ES module and CommonJS export
if (typeof module !== "undefined" && module.exports) {
    module.exports = YDSEPhysicsModel;
}
