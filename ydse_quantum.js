/**
 * YDSEQuantumSimulator.js
 * Genuine statistical Monte Carlo sampling simulation for single-photon quantum detection events.
 * 
 * Probability density: p(x) = I(x) / ∫ I(x) dx
 * Detections accumulate discretely on the observation screen over time.
 * Evolving histogram reflects the quantum wave-particle duality.
 */

class YDSEQuantumSimulator {
    constructor(physicsModel, options = {}) {
        this.physicsModel = physicsModel;
        this.screenWidth = options.screenWidth || 0.40;   // Physical screen sample range [-0.20m, +0.20m]
        this.numBins = options.numBins || 80;             // Number of histogram bins
        this.maxDetections = options.maxDetections || 50000;
        
        // Sampling parameters
        this.photonsPerSecond = options.photonsPerSecond || 100;
        this.isRunning = false;
        this.photonsEmitted = 0;
        this.photonsDetected = 0;
        
        // Detection storage (object-pooled / typed arrays for maximum performance)
        this.detectionHistory = [];
        this.histogramCounts = new Int32Array(this.numBins);
        
        // Precomputed probability distribution (CDF)
        this.cdfResolution = 500;
        this.cdfX = new Float64Array(this.cdfResolution);
        this.cdfValues = new Float64Array(this.cdfResolution);
        this.totalIntegral = 0;
        
        this.updateProbabilityDistribution();
    }

    /**
     * Precomputes the normalized CDF across the screen coordinate space.
     * Recomputed whenever physical parameters change.
     */
    updateProbabilityDistribution() {
        const halfW = this.screenWidth * 0.5;
        const step = this.screenWidth / (this.cdfResolution - 1);
        
        let cumulative = 0.0;
        this.cdfX[0] = -halfW;
        this.cdfValues[0] = 0.0;
        
        for (let i = 1; i < this.cdfResolution; i++) {
            const xPrev = -halfW + (i - 1) * step;
            const xCurr = -halfW + i * step;
            const xMid = 0.5 * (xPrev + xCurr);
            
            const intensityMid = this.physicsModel.calculateIntensity(xMid);
            cumulative += intensityMid * step;
            
            this.cdfX[i] = xCurr;
            this.cdfValues[i] = cumulative;
        }

        this.totalIntegral = cumulative;

        // Normalize CDF to [0, 1]
        if (this.totalIntegral > 1e-12) {
            for (let i = 0; i < this.cdfResolution; i++) {
                this.cdfValues[i] /= this.totalIntegral;
            }
        } else {
            // Both slits closed or laser inactive -> zero detection probability
            for (let i = 0; i < this.cdfResolution; i++) {
                this.cdfValues[i] = 0.0;
            }
        }
    }

    /**
     * Samples a single photon detection position x using inverse transform sampling (CDF).
     * Returns null if no detection (e.g. beam off or slits closed).
     */
    sampleDetection() {
        this.photonsEmitted++;

        if (this.totalIntegral <= 1e-12) {
            return null; // Both slits closed or laser off: photon absorbed by barrier
        }

        const u = Math.random();
        
        // Binary search in CDF
        let low = 0;
        let high = this.cdfResolution - 1;
        while (low < high) {
            const mid = (low + high) >> 1;
            if (this.cdfValues[mid] < u) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }

        // Linear interpolation between low - 1 and low
        let x = this.cdfX[low];
        if (low > 0) {
            const c0 = this.cdfValues[low - 1];
            const c1 = this.cdfValues[low];
            const x0 = this.cdfX[low - 1];
            const x1 = this.cdfX[low];
            if (c1 > c0) {
                const fraction = (u - c0) / (c1 - c0);
                x = x0 + fraction * (x1 - x0);
            }
        }

        // Vertical spread (Gaussian beam height falloff)
        const verticalSpread = (Math.random() - 0.5 + Math.random() - 0.5) * 0.08;

        this.photonsDetected++;

        // Update histogram
        const halfW = this.screenWidth * 0.5;
        const binIndex = Math.floor(((x + halfW) / this.screenWidth) * this.numBins);
        if (binIndex >= 0 && binIndex < this.numBins) {
            this.histogramCounts[binIndex]++;
        }

        const detection = { x: x, y: verticalSpread, id: this.photonsDetected };
        if (this.detectionHistory.length < this.maxDetections) {
            this.detectionHistory.push(detection);
        }

        return detection;
    }

    /**
     * Steps simulation forward by deltaTime seconds, generating Poisson or rate-based photon samples.
     */
    step(deltaTime) {
        if (!this.isRunning) return [];
        
        const expectedPhotons = this.photonsPerSecond * deltaTime;
        const numToSample = Math.floor(expectedPhotons) + (Math.random() < (expectedPhotons % 1) ? 1 : 0);
        
        const newDetections = [];
        for (let i = 0; i < numToSample; i++) {
            const det = this.sampleDetection();
            if (det) newDetections.push(det);
        }
        return newDetections;
    }

    /**
     * Emits a batch of N photons immediately.
     */
    emitBatch(n) {
        const newDetections = [];
        for (let i = 0; i < n; i++) {
            const det = this.sampleDetection();
            if (det) newDetections.push(det);
        }
        return newDetections;
    }

    /**
     * Resets detection accumulation while preserving physical parameters.
     */
    clearDetections() {
        this.detectionHistory = [];
        this.histogramCounts.fill(0);
        this.photonsEmitted = 0;
        this.photonsDetected = 0;
    }

    /**
     * Starts continuous photon emission.
     */
    start() {
        this.isRunning = true;
    }

    /**
     * Pauses photon emission.
     */
    pause() {
        this.isRunning = false;
    }

    /**
     * Returns theoretical vs empirical histogram data for analysis display.
     */
    getHistogramComparison() {
        const halfW = this.screenWidth * 0.5;
        const binWidth = this.screenWidth / this.numBins;
        const result = [];
        
        // Find max histogram count
        let maxCount = 0;
        for (let i = 0; i < this.numBins; i++) {
            if (this.histogramCounts[i] > maxCount) maxCount = this.histogramCounts[i];
        }

        for (let i = 0; i < this.numBins; i++) {
            const xCenter = -halfW + (i + 0.5) * binWidth;
            const theoreticalIntensity = this.physicsModel.calculateIntensity(xCenter);
            const count = this.histogramCounts[i];
            const observedFreq = this.photonsDetected > 0 ? count / this.photonsDetected : 0;
            
            result.push({
                binIndex: i,
                xCenter: xCenter,
                xCenterMm: xCenter * 1000.0,
                observedCount: count,
                normalizedObserved: maxCount > 0 ? count / maxCount : 0,
                theoreticalIntensity: theoreticalIntensity,
                normalizedTheoretical: this.physicsModel.peakIntensity > 0 ? theoreticalIntensity / this.physicsModel.peakIntensity : 0
            });
        }

        return {
            totalEmitted: this.photonsEmitted,
            totalDetected: this.photonsDetected,
            bins: result
        };
    }
}

// Support both ES module and CommonJS export
if (typeof module !== "undefined" && module.exports) {
    module.exports = YDSEQuantumSimulator;
}
