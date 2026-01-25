import streamDeck, { LogLevel } from "@elgato/streamdeck";
import net from "net";

const WINDOWER_PORT = 19769;

// Track running sequences to prevent double-triggering
const runningSequences = new Set();

// Track cycle positions per context (persisted in settings, but also cached here)
const cyclePositions = new Map();

/**
 * Sleep utility for delays between commands
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

streamDeck.logger.setLevel(LogLevel.DEBUG);

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
        const { command } = event.payload.settings;
        
        if (!command) {
            streamDeck.logger.warn('No command configured for this button');
            await event.action.showAlert();
            return;
        }
        
        try {
            await sendToWindower(command);
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
 */
streamDeck.actions.registerAction({
    manifestId: "com.atperry7.ffxi-windower.toggle",

    onKeyDown: async (event) => {
        const { command_on, command_off } = event.payload.settings;
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
            await sendToWindower(command);
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
 */
streamDeck.actions.registerAction({
    manifestId: "com.atperry7.ffxi-windower.sequence",

    onKeyDown: async (event) => {
        const context = event.action.id;
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
                    await sendToWindower(cmd.command);
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
        const settings = event.payload.settings;
        const commands = settings.commands || [];
        const showLabel = settings.showLabel !== false;

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
            // Execute the NEW state's command
            await sendToWindower(cmd.command);
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
            }

            // Brief visual feedback
            await event.action.setImage('imgs/action-on');
            setTimeout(() => {
                event.action.setImage('imgs/action-cycle');
            }, 200);

        } catch (err) {
            streamDeck.logger.error(`Cycle command failed: ${err.message}`);
            await event.action.showAlert();
        }
    }
});

// Connect to Stream Deck
streamDeck.connect();
