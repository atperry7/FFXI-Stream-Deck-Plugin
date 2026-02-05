import streamDeck, { LogLevel } from "@elgato/streamdeck";
import net from "net";

const WINDOWER_PORT = 19769;

// Track running sequences to prevent double-triggering
const runningSequences = new Set();

// Track cycle positions per context (persisted in settings, but also cached here)
const cyclePositions = new Map();

// Hold-to-reset functionality
const keyPressTimers = new Map();       // context -> press start timestamp
const holdFeedbackTimers = new Map();   // context -> dead zone setTimeout ID
const holdAnimationTimers = new Map();  // context -> animation setInterval ID

const HOLD_DEAD_ZONE = 200;            // ms before visual feedback begins
const HOLD_THRESHOLD = 1000;            // ms total to trigger reset
const HOLD_ANIMATION_FPS = 8;           // frames per second during ring fill
const HOLD_ANIMATION_DURATION = HOLD_THRESHOLD - HOLD_DEAD_ZONE; // 800ms of animation

/**
 * Generate an SVG progress ring for hold-to-reset visual feedback.
 * @param {number} percent - Fill percentage (0-100)
 * @param {number} size - SVG dimensions in pixels
 * @param {boolean} complete - If true, ring is green (ready to reset)
 */
function generateProgressRingSVG(percent, size = 144, complete = false) {
    const cx = size / 2;
    const cy = size / 2;
    const radius = (size / 2) - 8;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference * (1 - percent / 100);
    const color = complete ? '#44cc44' : '#ff4444';

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle cx="${cx}" cy="${cy}" r="${radius}" fill="black"
                stroke="#333" stroke-width="6"/>
        <circle cx="${cx}" cy="${cy}" r="${radius}" fill="none"
                stroke="${color}" stroke-width="6"
                stroke-dasharray="${circumference}"
                stroke-dashoffset="${offset}"
                stroke-linecap="round"
                transform="rotate(-90 ${cx} ${cy})"/>
    </svg>`;
}

/**
 * Start hold-to-reset detection on key down.
 * After HOLD_DEAD_ZONE ms, begins animating a progress ring on the button.
 */
function startHoldDetection(context, action) {
    keyPressTimers.set(context, Date.now());
    holdFeedbackTimers.set(context, setTimeout(() => {
        startProgressAnimation(context, action);
    }, HOLD_DEAD_ZONE));
}

/**
 * Begin the radial progress ring animation after the dead zone elapses.
 */
function startProgressAnimation(context, action) {
    const animStart = Date.now();

    const tick = async () => {
        if (!holdAnimationTimers.has(context)) return; // cancelled
        const elapsed = Date.now() - animStart;
        const progress = Math.min(100, (elapsed / HOLD_ANIMATION_DURATION) * 100);
        const complete = progress >= 100;
        const svg = generateProgressRingSVG(progress, 144, complete);
        const imageData = `data:image/svg+xml,${encodeURIComponent(svg)}`;
        await action.setImage(imageData);
        await action.setTitle("");

        if (complete) {
            clearInterval(holdAnimationTimers.get(context));
        }
    };

    // Run first frame immediately, then continue at HOLD_ANIMATION_FPS
    tick();
    holdAnimationTimers.set(context, setInterval(tick, 1000 / HOLD_ANIMATION_FPS));
}

/**
 * End hold-to-reset detection on key up.
 * Clears all timers and returns the total press duration in ms.
 */
function endHoldDetection(context) {
    const feedbackTimer = holdFeedbackTimers.get(context);
    if (feedbackTimer) clearTimeout(feedbackTimer);
    holdFeedbackTimers.delete(context);

    const animTimer = holdAnimationTimers.get(context);
    if (animTimer) clearInterval(animTimer);
    holdAnimationTimers.delete(context);

    const startTime = keyPressTimers.get(context);
    keyPressTimers.delete(context);
    return startTime ? Date.now() - startTime : 0;
}

/**
 * Sleep utility for delays between commands
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

streamDeck.logger.setLevel(LogLevel.DEBUG);

/**
 * Determine the routing target from button settings.
 * Priority: character field > focus checkbox > @main
 */
function getTarget(settings) {
    const character = (settings.character || '').trim();
    if (character) return character;
    return settings.focus !== false ? '@focus' : '@main';
}

/**
 * Format a command with its routing target for the TCP protocol.
 * Format: <target>|<command>
 */
function formatCommand(settings, command) {
    return `${getTarget(settings)}|${command}`;
}

/**
 * Send a command to the Windower StreamDeckBridge addon
 */
function sendToWindower(command) {
    return new Promise((resolve, reject) => {
        const client = new net.Socket();
        
        client.setTimeout(2000);
        
        client.connect(WINDOWER_PORT, '127.0.0.1', () => {
            client.write(command + '\n');
            client.end();
            resolve();
        });
        
        client.on('error', (err) => {
            streamDeck.logger.error(`Connection failed: ${err.message}`);
            reject(err);
        });
        
        client.on('timeout', () => {
            client.destroy();
            reject(new Error('Connection timeout'));
        });
    });
}

/**
 * Execute Command action - sends a configured command to Windower
 */
streamDeck.actions.registerAction({
    manifestId: "com.atperry7.ffxi-windower.execute",
    
    onKeyDown: async (event) => {
        const settings = event.payload.settings;
        const { command } = settings;

        if (!command) {
            streamDeck.logger.warn('No command configured for this button');
            await event.action.showAlert();
            return;
        }

        try {
            await sendToWindower(formatCommand(settings, command));
            streamDeck.logger.info(`Sent: ${command}`);
            // Brief green flash feedback
            await event.action.setImage('imgs/action-on');
            setTimeout(() => {
                event.action.setImage('imgs/action');
            }, 300);
        } catch (err) {
            streamDeck.logger.error(`Failed to send command: ${err.message}`);
            await event.action.showAlert();
        }
    }
});

/**
 * Toggle Command action - toggles between two commands with visual state
 * Hold (1s+) resets to OFF state without sending command
 */
streamDeck.actions.registerAction({
    manifestId: "com.atperry7.ffxi-windower.toggle",

    onKeyDown: async (event) => {
        startHoldDetection(event.action.id, event.action);
    },

    onKeyUp: async (event) => {
        const context = event.action.id;
        const pressDuration = endHoldDetection(context);
        const currentState = event.payload.state; // 0 = off, 1 = on

        // Clear custom image override if hold entered visual feedback phase
        // Using undefined lets the manifest's state-based icons take control again
        if (pressDuration > HOLD_DEAD_ZONE) {
            await event.action.setImage(undefined);
        }

        // Long press: reset to OFF state
        if (pressDuration >= HOLD_THRESHOLD) {
            streamDeck.logger.info('Toggle reset to OFF state');
            await event.action.setState(0);
            return;
        }

        // Short press: normal toggle behavior
        const settings = event.payload.settings;
        const { command_on, command_off } = settings;

        // State 0 (OFF): send command_on to activate
        // State 1 (ON): send command_off to deactivate
        const command = currentState === 0 ? command_on : command_off;
        const nextState = currentState === 0 ? 1 : 0;

        if (!command) {
            streamDeck.logger.warn('No command configured for this toggle state');
            await event.action.showAlert();
            return;
        }

        try {
            await sendToWindower(formatCommand(settings, command));
            streamDeck.logger.info(`Toggle sent: ${command}`);
            await event.action.setState(nextState);
        } catch (err) {
            streamDeck.logger.error(`Failed to send toggle command: ${err.message}`);
            await event.action.showAlert();
        }
    }
});

/**
 * Sequence Command action - executes multiple commands in sequence with delays
 * Hold (1s+) clears stuck sequence guard without sending commands
 */
streamDeck.actions.registerAction({
    manifestId: "com.atperry7.ffxi-windower.sequence",

    onKeyDown: async (event) => {
        const context = event.action.id;

        // Don't start hold detection if sequence is running (would interfere with progress)
        if (!runningSequences.has(context)) {
            startHoldDetection(context, event.action);
        }
    },

    onKeyUp: async (event) => {
        const context = event.action.id;
        const pressDuration = endHoldDetection(context);

        // Restore original image if hold entered visual feedback phase
        if (pressDuration > HOLD_DEAD_ZONE && !runningSequences.has(context)) {
            await event.action.setImage('imgs/action-sequence');
        }

        // Long press: clear from runningSequences (in case stuck)
        if (pressDuration >= HOLD_THRESHOLD) {
            const wasRunning = runningSequences.has(context);
            runningSequences.delete(context);
            streamDeck.logger.info(`Sequence reset${wasRunning ? ' (was stuck)' : ''}`);
            await event.action.setImage('imgs/action-sequence');
            await event.action.setTitle("");
            return;
        }

        // Short press: run sequence
        const settings = event.payload.settings;
        const commands = settings.commands || [];
        const delay = parseInt(settings.delay) || 500;
        const onError = settings.onError || "stop";

        if (commands.length === 0) {
            streamDeck.logger.warn('No commands configured for sequence');
            await event.action.showAlert();
            return;
        }

        // Prevent double-triggering
        if (runningSequences.has(context)) {
            streamDeck.logger.info('Sequence already running, ignoring');
            return;
        }

        runningSequences.add(context);

        try {
            for (let i = 0; i < commands.length; i++) {
                const cmd = commands[i];
                if (!cmd.command) continue;

                // Show progress on key title (label if available, otherwise step number)
                const titleText = cmd.label || `${i + 1}/${commands.length}`;
                await event.action.setTitle(titleText);

                try {
                    const cmdSettings = cmd.character ? { ...settings, character: cmd.character } : settings;
                    await sendToWindower(formatCommand(cmdSettings, cmd.command));
                    streamDeck.logger.info(`Sequence [${i + 1}/${commands.length}]: ${cmd.command}`);
                } catch (err) {
                    streamDeck.logger.error(`Sequence command failed: ${err.message}`);
                    if (onError === "stop") {
                        await event.action.showAlert();
                        return;
                    }
                }

                // Delay before next command (except after the last one)
                if (i < commands.length - 1) {
                    await sleep(delay);
                }
            }

            // Success feedback
            await event.action.showOk();
        } finally {
            runningSequences.delete(context);
            // Clear title after completion
            await event.action.setTitle("");
        }
    }
});

/**
 * Cycle Command action - cycles through a list of commands
 * Hold (1s+) resets to first position without sending command
 */
streamDeck.actions.registerAction({
    manifestId: "com.atperry7.ffxi-windower.cycle",

    onWillAppear: async (event) => {
        const context = event.action.id;
        const settings = event.payload.settings;
        const commands = settings.commands || [];
        const currentIndex = parseInt(settings.currentIndex) || 0;
        const showLabel = settings.showLabel !== false;

        // Cache the position
        cyclePositions.set(context, currentIndex);

        // Update display with current command label
        if (showLabel && commands.length > 0) {
            const safeIndex = currentIndex % commands.length;
            const label = commands[safeIndex]?.label || `${safeIndex + 1}`;
            await event.action.setTitle(label);
        }
    },

    onDidReceiveSettings: async (event) => {
        const context = event.action.id;
        const settings = event.payload.settings;
        const commands = settings.commands || [];
        const currentIndex = parseInt(settings.currentIndex) || 0;
        const showLabel = settings.showLabel !== false;

        // Update cached position
        cyclePositions.set(context, currentIndex);

        // Update display
        if (showLabel && commands.length > 0) {
            const safeIndex = currentIndex % commands.length;
            const label = commands[safeIndex]?.label || `${safeIndex + 1}`;
            await event.action.setTitle(label);
        } else if (!showLabel) {
            await event.action.setTitle("");
        }
    },

    onKeyDown: async (event) => {
        startHoldDetection(event.action.id, event.action);
    },

    onKeyUp: async (event) => {
        const context = event.action.id;
        const pressDuration = endHoldDetection(context);

        const settings = event.payload.settings;
        const commands = settings.commands || [];
        const showLabel = settings.showLabel !== false;

        // Restore original image/label if hold entered visual feedback phase
        if (pressDuration > HOLD_DEAD_ZONE) {
            await event.action.setImage('imgs/action-cycle');
            // Restore the current label
            const currentIndex = cyclePositions.get(context) ?? (parseInt(settings.currentIndex) || 0);
            if (showLabel && commands.length > 0) {
                const safeIndex = currentIndex % commands.length;
                const label = commands[safeIndex]?.label || `${safeIndex + 1}`;
                await event.action.setTitle(label);
            } else {
                await event.action.setTitle("");
            }
        }

        // Long press: reset to first position (index 0)
        if (pressDuration >= HOLD_THRESHOLD) {
            streamDeck.logger.info('Cycle reset to position 0');

            cyclePositions.set(context, 0);

            await event.action.setSettings({
                ...settings,
                currentIndex: 0
            });

            // Restore first label
            if (showLabel && commands.length > 0) {
                const label = commands[0]?.label || "1";
                await event.action.setTitle(label);
            } else {
                await event.action.setTitle("");
            }
            return;
        }

        // Short press: normal cycle behavior
        if (commands.length === 0) {
            streamDeck.logger.warn('No commands configured for cycle');
            await event.action.showAlert();
            return;
        }

        // Get current index from cache or settings
        let currentIndex = cyclePositions.get(context) ?? (parseInt(settings.currentIndex) || 0);
        currentIndex = currentIndex % commands.length; // Safety wrap

        // Advance to next index FIRST (cycle, then execute)
        const nextIndex = (currentIndex + 1) % commands.length;
        const cmd = commands[nextIndex];

        if (!cmd?.command) {
            streamDeck.logger.warn('Empty command in cycle');
            await event.action.showAlert();
            return;
        }

        try {
            // Execute the NEW state's command (per-command character overrides button-level target)
            const cmdSettings = cmd.character ? { ...settings, character: cmd.character } : settings;
            await sendToWindower(formatCommand(cmdSettings, cmd.command));
            streamDeck.logger.info(`Cycle to [${nextIndex + 1}/${commands.length}]: ${cmd.command}`);

            // Update cached position to new state
            cyclePositions.set(context, nextIndex);

            // Persist the new index to settings
            await event.action.setSettings({
                ...settings,
                currentIndex: nextIndex
            });

            // Update display to show current state (what we just switched to)
            if (showLabel) {
                const label = cmd.label || `${nextIndex + 1}`;
                await event.action.setTitle(label);
            } else {
                await event.action.setTitle("");
            }

            // Brief visual feedback
            await event.action.setImage('imgs/action-on');
            setTimeout(() => {
                event.action.setImage('imgs/action-cycle');
            }, 200);

        } catch (err) {
            streamDeck.logger.error(`Cycle command failed: ${err.message}`);
            await event.action.showAlert();
            // Restore the label on error
            if (showLabel && commands.length > 0) {
                const safeIndex = currentIndex % commands.length;
                const label = commands[safeIndex]?.label || `${safeIndex + 1}`;
                await event.action.setTitle(label);
            } else {
                await event.action.setTitle("");
            }
        }
    }
});

// Connect to Stream Deck
streamDeck.connect();
