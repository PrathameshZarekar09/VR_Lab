/**
 * YDSELessonDirector.js
 * Comprehensive 9-minute structured educational curriculum and lesson state machine.
 * Supports guided progression, active prediction challenges, and an interactive physics quiz.
 */

class YDSELessonDirector {
    constructor(experimentController, uiCallbacks = {}) {
        this.controller = experimentController;
        this.callbacks = uiCallbacks;
        
        this.currentStage = 1;
        this.totalStages = 6;
        this.quizScore = 0;
        this.quizAnswers = {};
        
        this.stages = [
            {
                id: 1,
                title: "Stage 1: Welcome & Orientation",
                duration: "0:00 – 1:00",
                objective: "Identify the laser emitter, double-slit barrier, optical rail, and observation screen.",
                prompt: "Welcome to Thomas Young's Double-Slit Experiment (1801)! This seminal experiment established the wave theory of light and laid the foundation for modern quantum wave-particle duality. Look at the laboratory setup: light travels from the Laser Source on your right, passes through the Double-Slit Barrier, and projects onto the movable Observation Screen.",
                action: "Turn on the laser and locate the central bright fringe on the observation screen.",
                targetCheck: () => this.controller.physicsModel.laserActive
            },
            {
                id: 2,
                title: "Stage 2: Explore the Apparatus",
                duration: "1:00 – 2:15",
                objective: "Observe how fringe spacing changes when you slide the observation screen along the optical rail.",
                prompt: "Notice the alternating bright and dark bands on the screen. These are interference fringes! The distance between consecutive bright fringes is the fringe width β (beta). Try sliding the observation screen further away (increasing D) or changing the laser wavelength λ.",
                action: "Adjust the screen distance slider or drag the screen along the optical rail.",
                targetCheck: () => Math.abs(this.controller.physicsModel.screenDistance - 1.20) > 0.15
            },
            {
                id: 3,
                title: "Stage 3: Physical Principles & Phase Difference",
                duration: "2:15 – 4:00",
                objective: "Understand path difference Δr and phase difference Δφ.",
                prompt: "Light waves from both coherent slits travel distances r₁ and r₂ to reach point x on the screen. The path difference is Δr = |r₂ - r₁| ≈ x·d / D. Constructive interference (bright fringe) occurs when Δr = m·λ (phase difference Δφ = 2mπ). Destructive interference (dark gap) occurs when Δr = (m + 0.5)·λ (Δφ = (2m+1)π).",
                action: "Hover or click on the observation screen to sample the exact path difference and phase difference at that position.",
                targetCheck: () => true
            },
            {
                id: 4,
                title: "Stage 4: Prediction & Parameter Exploration",
                duration: "4:00 – 5:45",
                objective: "Verify the fundamental formula: β = (λ · D) / d.",
                prompt: "According to wave optics, fringe spacing is β = (λ · D) / d. What happens when you decrease the slit separation d? The fringes spread further apart! What happens when you close one slit? The interference fringes disappear, leaving only a broad single-slit diffraction pattern.",
                action: "Try closing one slit using the slit toggles (Left Slit Only or Right Slit Only).",
                targetCheck: () => (!this.controller.physicsModel.leftSlitOpen || !this.controller.physicsModel.rightSlitOpen)
            },
            {
                id: 5,
                title: "Stage 5: Quantum Single-Photon Mode",
                duration: "5:45 – 7:30",
                objective: "Witness quantum wave-particle duality: single photon clicks accumulating into a wave pattern.",
                prompt: "Switch to Single-Photon Quantum Mode. When light intensity is reduced to individual quanta (photons), each photon arrives as a localized, discrete dot on the screen. An individual photon never splits or spreads into pieces. Yet over thousands of emissions, the statistical detection histogram perfectly reproduces the classical interference pattern! The probability density is p(x) = I(x) / ∫I(x)dx.",
                action: "Switch to Single-Photon Mode and accumulate at least 500 detections.",
                targetCheck: () => this.controller.quantumSimulator && this.controller.quantumSimulator.photonsDetected >= 500
            },
            {
                id: 6,
                title: "Stage 6: Conclusion & Knowledge Quiz",
                duration: "7:30 – 9:00",
                objective: "Test your understanding with 5 conceptual physics questions.",
                prompt: "Complete the physics mastery quiz below to consolidate your understanding of wave optics and quantum mechanics. Detailed feedback will explain each answer.",
                action: "Answer the quiz questions below.",
                targetCheck: () => Object.keys(this.quizAnswers).length >= 5
            }
        ];

        this.quizQuestions = [
            {
                id: "q1",
                question: "1. What happens to the fringe spacing β when the observation screen distance D is doubled?",
                options: [
                    "A) The fringe spacing is halved (β becomes β/2)",
                    "B) The fringe spacing doubles (β becomes 2β)",
                    "C) The fringe spacing remains unchanged",
                    "D) The fringes disappear entirely"
                ],
                correctIndex: 1,
                explanation: "Correct! From the formula β = (λ · D) / d, fringe spacing is directly proportional to screen distance D. Doubling D doubles the fringe width."
            },
            {
                id: "q2",
                question: "2. What happens to the interference fringes when the slit separation d is increased?",
                options: [
                    "A) Fringes move closer together (β decreases)",
                    "B) Fringes spread further apart (β increases)",
                    "C) Fringes change color",
                    "D) Fringes become completely dark"
                ],
                correctIndex: 0,
                explanation: "Correct! Fringe spacing β is inversely proportional to slit separation d (β = λD / d). Increasing d causes the fringes to become narrower and pack closer together."
            },
            {
                id: "q3",
                question: "3. If a 405 nm violet laser is replaced with a 632.8 nm red laser, how does the fringe spacing change?",
                options: [
                    "A) Fringes become narrower (β decreases)",
                    "B) Fringes become wider (β increases)",
                    "C) Fringe spacing does not change with wavelength",
                    "D) Central maximum disappears"
                ],
                correctIndex: 1,
                explanation: "Correct! Wavelength λ of red light (632.8 nm) is longer than violet light (405 nm). Since β ∝ λ, longer wavelengths produce wider fringe spacing."
            },
            {
                id: "q4",
                question: "4. What is observed on the screen when only one slit is left open?",
                options: [
                    "A) Half of the two-slit interference fringes disappear",
                    "B) A broad single-slit diffraction pattern with no two-slit interference fringes",
                    "C) A single razor-thin geometric shadow line",
                    "D) The screen becomes completely dark"
                ],
                correctIndex: 1,
                explanation: "Correct! Two-slit interference requires two mutually coherent wave sources to superpose. With only one slit open, the interference cross-term disappears, leaving only single-slit Fraunhofer diffraction sinc²(u)."
            },
            {
                id: "q5",
                question: "5. In single-photon mode, why does a recognizable interference pattern emerge only after many detections?",
                options: [
                    "A) The photons bump into each other in flight",
                    "B) Each photon arrives as an individual quantum event, but its detection probability is governed by the wave intensity distribution p(x) ∝ I(x)",
                    "C) The laser warms up over time",
                    "D) The screen needs time to charge up"
                ],
                correctIndex: 1,
                explanation: "Correct! This is the essence of quantum wave-particle duality (Born rule): light exhibits particle-like discrete detection events, but the spatial probability density p(x) of detecting each photon is strictly determined by the wave interference intensity I(x)."
            }
        ];
    }

    goToStage(stageNumber) {
        if (stageNumber < 1 || stageNumber > this.totalStages) return;
        this.currentStage = stageNumber;
        if (this.callbacks.onStageChange) {
            this.callbacks.onStageChange(this.getStageInfo());
        }
    }

    nextStage() {
        if (this.currentStage < this.totalStages) {
            this.goToStage(this.currentStage + 1);
        }
    }

    prevStage() {
        if (this.currentStage > 1) {
            this.goToStage(this.currentStage - 1);
        }
    }

    getStageInfo() {
        return this.stages[this.currentStage - 1];
    }

    submitQuizAnswer(questionId, selectedIndex) {
        this.quizAnswers[questionId] = selectedIndex;
        const q = this.quizQuestions.find(item => item.id === questionId);
        const isCorrect = (q && q.correctIndex === selectedIndex);
        
        // Recalculate score
        let score = 0;
        for (const question of this.quizQuestions) {
            if (this.quizAnswers[question.id] === question.correctIndex) {
                score++;
            }
        }
        this.quizScore = score;

        if (this.callbacks.onQuizAnswer) {
            this.callbacks.onQuizAnswer({
                questionId: questionId,
                selectedIndex: selectedIndex,
                isCorrect: isCorrect,
                explanation: q.explanation,
                totalScore: this.quizScore,
                totalQuestions: this.quizQuestions.length
            });
        }

        return { isCorrect, explanation: q.explanation, score: this.quizScore };
    }
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = YDSELessonDirector;
}
