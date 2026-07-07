# FFXI Stream Deck Plugin

Control Final Fantasy XI through your Elgato Stream Deck. Send commands directly to Windower with the press of a button.

## Features

- **Execute Command** - Send any Windower command with a single button press
- **Toggle Command** - Switch between two states (e.g., enable/disable a setting)
- **Sequence Command** - Execute multiple commands in order with configurable delays
- **Cycle Command** - Rotate through a list of commands (e.g., cycle through targets or gear sets)
- **Per-button targeting** - Route commands to the focused window, a specific character, or all characters

## Requirements

- Windows 10 or later
- Elgato Stream Deck software 6.4+
- [Windower 4](https://www.windower.net/) for FFXI
- **StreamDeckBridge addon** for Windower (required for communication)
  - https://github.com/atperry7/StreamDeckBridge

### Installing the StreamDeckBridge Addon

The plugin communicates with Windower through the StreamDeckBridge addon, which listens on port 19769.

1. Download the StreamDeckBridge addon
2. Place it in your `Windower4/addons/` folder
3. Load it in-game: `//lua load streamdeckbridge`
4. Set the server character: `//sdb enable`
5. (Optional) Add to your `Windower4/scripts/init.txt` for auto-loading
6. Load the addon on all other characters that should receive targeted commands

## Installation

1. Download the latest `.streamDeckPlugin` file from [Releases](../../releases)
2. Double-click the file to install
3. The "FFXI" category will appear in your Stream Deck actions

## Command Targeting

Every button has two targeting fields:

| Setting | Description |
|---------|-------------|
| **Character** | (Optional) A character name, or `@all` to target every character |
| **Focus Mode** | When checked (default), commands are sent to whichever FFXI window has focus |

**Routing priority:**

1. If **Character** has a value, the command is sent to that character (or `@all` for everyone)
2. If **Focus Mode** is checked and Character is empty, the command runs on the focused window
3. If **Focus Mode** is unchecked and Character is empty, the command runs directly on the server character

This means you can have buttons that always target a specific alt, buttons that follow focus, and buttons that reliably execute on the server regardless of which window is active (useful for commands like `switch_focus`).

## Actions

### Execute Command

Sends a single command to Windower when pressed.

| Setting | Description |
|---------|-------------|
| Character | (Optional) Target character name or `@all` |
| Focus Mode | Send to focused window (default: on) |
| Command | The Windower command to execute |

**Examples:**
- `input /ma "Cure" <t>` - Cast a spell
- `input /ja "Provoke" <t>` - Use a job ability
- `input /ws "Savage Blade" <t>` - Execute a weapon skill
- `send Whitey input /ma "Cure IV" <me>` - Send command to a multibox character
- `gs c toggle MagicBurst` - Send a GearSwap command

### Toggle Command

Alternates between two commands, with visual ON/OFF state.

| Setting | Description |
|---------|-------------|
| Character | (Optional) Target character name or `@all` |
| Focus Mode | Send to focused window (default: on) |
| ON Command | Command to send when turning ON |
| OFF Command | Command to send when turning OFF |

**Use cases:**
- Toggle a GearSwap mode: `gs c set DefenseMode Physical` / `gs c unset DefenseMode`
- Enable/disable an addon feature
- Switch between two macros

### Sequence Command

Executes multiple commands in order with a delay between each.

| Setting | Description |
|---------|-------------|
| Character | (Optional) Target character name or `@all` |
| Focus Mode | Send to focused window (default: on) |
| Commands | List of commands to execute in order |
| Delay | Milliseconds to wait between commands (default: 500) |
| On Error | `Stop` or `Continue` if a command fails |

**Use cases:**
- Chain buffs: Protect -> Shell -> Haste
- Execute a series of setup commands
- Automated crafting sequences

The button displays progress as the sequence runs.

### Cycle Command

Rotates through a list of commands. Each press advances to the next command.

| Setting | Description |
|---------|-------------|
| Character | (Optional) Target character name or `@all` |
| Focus Mode | Send to focused window (default: on) |
| Commands | List of commands with optional labels |
| Show Label | Display the current position on the button |
| Reset Position | Button to reset back to the first command |

**Use cases:**
- Cycle through gear sets
- Rotate between different targets
- Switch between combat modes

## Hold to Reset

Toggle, Sequence, and Cycle actions support a hold gesture. Hold the button for 1 second to reset its state without sending a command:

- **Toggle** - Resets to the OFF state (useful if the toggle gets out of sync with the game)
- **Sequence** - Cancels a running sequence mid-flight (takes effect within ~100ms, even during a delay)
- **Cycle** - Resets back to the first position

Quick taps work normally with no visual interference. After a 200ms dead zone, a radial progress ring fills around the button icon. When the ring completes and turns green, releasing the button triggers the reset (confirmed with a checkmark). Releasing before the ring completes cancels the reset and executes the normal action instead.

## Troubleshooting

### Button shows alert (yellow triangle)

- **Windower not running** - Start FFXI with Windower
- **StreamDeckBridge not loaded** - Run `//lua load streamdeckbridge` in-game
- **No command configured** - Open the button settings and enter a command

### Commands not working

- Test commands manually in Windower first (e.g., `//input /wave`)
- Check the StreamDeckBridge addon is responding: `//lua r streamdeckbridge`
- Verify the command syntax is correct

### Commands not reaching a specific character

- Make sure StreamDeckBridge is loaded on the target character
- Check that the Character field matches the in-game name exactly (case-insensitive)

### Connection behavior

The plugin holds a single persistent connection to the StreamDeckBridge addon, which guarantees commands execute in the order you press them. If the connection drops (game restart, addon reload), it reconnects automatically on the next press. A press while Windower is down shows an alert; just press again once the addon is loaded.

## Building from Source

```bash
# Clone the repository
git clone https://github.com/atperry7/FFXI-Stream-Deck-Plugin.git
cd FFXI-Stream-Deck-Plugin

# Install dependencies
npm install

# Install Stream Deck CLI
npm install -g @elgato/cli

# Package the plugin
streamdeck pack .
```

## License

MIT License - See [LICENSE](LICENSE) for details.

## Credits

- Built with the [Elgato Stream Deck SDK](https://developer.elgato.com/documentation/stream-deck/)
- For use with [Windower](https://www.windower.net/)
