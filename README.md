# FFXI Windower Stream Deck Plugin

Control Final Fantasy XI through your Elgato Stream Deck. Send commands directly to Windower with the press of a button.

## Features

- **Execute Command** - Send any Windower command with a single button press
- **Toggle Command** - Switch between two states (e.g., enable/disable a setting)
- **Sequence Command** - Execute multiple commands in order with configurable delays
- **Cycle Command** - Rotate through a list of commands (e.g., cycle through targets or gear sets)

## Requirements

- Windows 10 or later
- Elgato Stream Deck software 6.0+
- [Windower 4](https://www.windower.net/) for FFXI
- **StreamDeckBridge addon** for Windower (required for communication)

### Installing the StreamDeckBridge Addon

The plugin communicates with Windower through the StreamDeckBridge addon, which listens on port 19769.

1. Download the StreamDeckBridge addon
2. Place it in your `Windower4/addons/` folder
3. Load it in-game: `//lua load streamdeckbridge`
4. (Optional) Add to your `Windower4/scripts/init.txt` for auto-loading

## Installation

1. Download the latest `.streamDeckPlugin` file from [Releases](../../releases)
2. Double-click the file to install
3. The "FFXI" category will appear in your Stream Deck actions

## Actions

### Execute Command

Sends a single command to Windower when pressed.

| Setting | Description |
|---------|-------------|
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
| Commands | List of commands to execute in order |
| Delay | Milliseconds to wait between commands (default: 500) |
| On Error | `Stop` or `Continue` if a command fails |

**Use cases:**
- Chain buffs: Protect → Shell → Haste
- Execute a series of setup commands
- Automated crafting sequences

The button displays progress as the sequence runs.

### Cycle Command

Rotates through a list of commands. Each press advances to the next command.

| Setting | Description |
|---------|-------------|
| Commands | List of commands with optional labels |
| Show Label | Display the current position on the button |
| Reset Position | Button to reset back to the first command |

**Use cases:**
- Cycle through gear sets
- Rotate between different targets
- Switch between combat modes

## Troubleshooting

### Button shows alert (yellow triangle)

- **Windower not running** - Start FFXI with Windower
- **StreamDeckBridge not loaded** - Run `//lua load streamdeckbridge` in-game
- **No command configured** - Open the button settings and enter a command

### Commands not working

- Test commands manually in Windower first (e.g., `//input /wave`)
- Check the StreamDeckBridge addon is responding: `//lua r streamdeckbridge`
- Verify the command syntax is correct

### Connection timeout

The plugin uses a 2-second timeout. If Windower is busy (loading, zoning), commands may timeout. Try again once the game is responsive.

## Building from Source

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/ffxi-windower-streamdeck.git
cd ffxi-windower-streamdeck

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
