import streamDeck, { LogLevel } from "@elgato/streamdeck";
import net from "net";

const WINDOWER_PORT = 19769;

// Track running sequences to prevent double-triggering
const runningSequences = new Set();

// Track cycle positions per context (persisted in settings, but also cached here)
const cyclePositions = new Map();

// Long press to reset functionality
const keyPressTimers = new Map();  // Track press start times by context
const LONG_PRESS_THRESHOLD = 750;  // milliseconds

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
 * Long press (750ms+) resets to OFF state without sending command
 */
streamDeck.actions.registerAction({
    manifestId: "com.atperry7.ffxi-windower.toggle",

    onKeyDown: async (event) => {
        const context = event.action.id;
        keyPressTimers.set(context, Date.now());
        await event.action.setTitle("Hold...");
    },

    onKeyUp: async (event) => {
        const context = event.action.id;
        const startTime = keyPressTimers.get(context);
        keyPressTimers.delete(context);

        // Clear the "Hold..." title
        await event.action.setTitle("");

        const pressDuration = startTime ? Date.now() - startTime : 0;

        // Long press: reset to OFF state
        if (pressDuration >= LONG_PRESS_THRESHOLD) {
            streamDeck.logger.info('Toggle reset to OFF state');
            await event.action.setState(0);
            await event.action.setTitle("RESET!");
            setTimeout(() => {
                event.action.setTitle("");
            }, 500);
            return;
        }

        // Short press: normal toggle behavior
        const settings = event.payload.settings;
        const { command_on, command_off } = settings;
        const currentState = event.payload.state; // 0 = off, 1 = on

        // Determine which command to send based on current state
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
 * Long press (750ms+) clears stuck sequence guard without sending commands
 */
streamDeck.actions.registerAction({
    manifestId: "com.atperry7.ffxi-windower.sequence",

    onKeyDown: async (event) => {
        const context = event.action.id;

        // Don't show "Hold..." if sequence is already running (would interfere with progress)
        if (!runningSequences.has(context)) {
            keyPressTimers.set(context, Date.now());
            await event.action.setTitle("Hold...");
        }
    },

    onKeyUp: async (event) => {
        const context = event.action.id;
        const startTime = keyPressTimers.get(context);
        keyPressTimers.delete(context);

        const pressDuration = startTime ? Date.now() - startTime : 0;

        // Long press: clear from runningSequences (in case stuck)
        if (pressDuration >= LONG_PRESS_THRESHOLD) {
            const wasRunning = runningSequences.has(context);
            runningSequences.delete(context);
            streamDeck.logger.info(`Sequence reset${wasRunning ? ' (was stuck)' : ''}`);
            await event.action.setTitle("RESET!");
            setTimeout(() => {
                event.action.setTitle("");
            }, 500);
            return;
        }

        // Clear "Hold..." if it was showing (sequence wasn't running)
        if (startTime && !runningSequences.has(context)) {
            await event.action.setTitle("");
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
                    await sendToWindower(formatCommand(settings, cmd.command));
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
 * Long press (750ms+) resets to first position without sending command
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
        const context = event.action.id;
        keyPressTimers.set(context, Date.now());
        await event.action.setTitle("Hold...");
    },

    onKeyUp: async (event) => {
        const context = event.action.id;
        const startTime = keyPressTimers.get(context);
        keyPressTimers.delete(context);

        const settings = event.payload.settings;
        const commands = settings.commands || [];
        const showLabel = settings.showLabel !== false;

        const pressDuration = startTime ? Date.now() - startTime : 0;

        // Long press: reset to first position (index 0)
        if (pressDuration >= LONG_PRESS_THRESHOLD) {
            streamDeck.logger.info('Cycle reset to position 0');

            // Reset to index 0
            cyclePositions.set(context, 0);

            // Persist reset index to settings
            await event.action.setSettings({
                ...settings,
                currentIndex: 0
            });

            // Show reset feedback, then show first label
            await event.action.setTitle("RESET!");
            setTimeout(async () => {
                if (showLabel && commands.length > 0) {
                    const label = commands[0]?.label || "1";
                    await event.action.setTitle(label);
                } else {
                    await event.action.setTitle("");
                }
            }, 500);
            return;
        }

        // Short press: normal cycle behavior
        if (commands.length === 0) {
            streamDeck.logger.warn('No commands configured for cycle');
            await event.action.showAlert();
            await event.action.setTitle("");
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
            if (showLabel && commands.length > 0) {
                const safeIndex = currentIndex % commands.length;
                const label = commands[safeIndex]?.label || `${safeIndex + 1}`;
                await event.action.setTitle(label);
            } else {
                await event.action.setTitle("");
            }
            return;
        }

        try {
            // Execute the NEW state's command
            await sendToWindower(formatCommand(settings, cmd.command));
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
