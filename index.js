require("dotenv").config();

const Discord = require("discord.js");
const spotify = require("@suchipi/spotify-player");
const py = require("pypress");
const prism = require("prism-media");
const onExit = require("on-exit");

const client = new Discord.Client();

client.on("ready", () => {
  console.log(`Logged in as ${client.user.tag}!`);
  spotify.login(process.env.SPOTIFY_USERNAME, process.env.SPOTIFY_PASSWORD);
  py.then(() => {
    console.log("logged in to Spotify");
  });
});

const state = {
  text: {
    channel: null,
  },
  voice: {
    channel: null,
    connection: null,
  },
  alsaStream: null,
  bitrate: 320000 /* 320kbps */,
};

function joinAndPlayStream() {
  if (!state.voice.connection) {
    if (state.voice.channel) {
      state.voice.channel
        .join()
        .then((connection) => {
          state.voice.connection = connection;
          joinAndPlayStream();
        })
        .catch((err) => {
          if (state.text.channel) {
            state.text.channel.send(
              ["Join error", "```", err.stack, "```"].join("\n")
            );
          }
        });
      return;
    } else {
      if (state.text.channel) {
        state.text.channel.send(
          "Can't join voice channel because state.voice.channel is null"
        );
      }

      return;
    }
  }

  if (state.alsaStream) {
    state.alsaStream.destroy();
  }
  state.alsaStream = new prism.FFmpeg({
    args:
      // prettier-ignore
      [
        '-analyzeduration', '0',
        '-loglevel', '0',
        '-f', 'alsa',
        '-i', process.env.ALSA_DEVICE,
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
      ],
  });

  console.log(`Playing alsa stream at bitrate ${state.bitrate}`);
  state.voice.connection.playConvertedStream(state.alsaStream, {
    bitrate: state.bitrate,
  });
}

function disconnectFromVoice() {
  if (state.alsaStream) {
    state.alsaStream.destroy();
    state.alsaStream = null;
  }

  if (state.voice.connection) {
    state.voice.connection.disconnect();
    state.voice.connection = null;
  }
}

onExit(() => {
  disconnectFromVoice();
  spotify.logout();
  client.destroy();
});
onExit.logger(console.log.bind(console));

client.on("message", (message) => {
  console.log(
    `${message.channel.name}: ${message.author.username} (${message.author.id}): ${message.content}`
  );

  if (message.content.startsWith(".spotify ")) {
    state.text.channel = message.channel;

    py.onError = (err) => {
      message.channel.send(
        ["Error:", "```", JSON.stringify(err.stack), "```"].join("\n")
      );
    };

    const [command, ...args] = message.content
      .replace(/^\.spotify /, "")
      .split(/\s/);

    switch (command) {
      case "bitrate": {
        if (args.length === 0) {
          message.channel.send(
            `The bitrate is currently set to ${state.bitrate}bps.`
          );
        } else {
          const newBitrate = parseInt(args[0]);
          if (!Number.isNaN(newBitrate)) {
            state.bitrate = newBitrate;

            message.channel.send(`Bitrate set to ${newBitrate}bps.`);

            disconnectFromVoice();
            joinAndPlayStream();
          }
        }

        break;
      }

      case "restart": {
        spotify.logout();
        spotify.login(
          process.env.SPOTIFY_USERNAME,
          process.env.SPOTIFY_PASSWORD
        );
        break;
      }

      case "exit": {
        disconnectFromVoice();
        spotify.logout();
        Promise.all([py, client.destroy()]).then(() => {
          process.exit();
        });
      }

      case "join": {
        if (message.member.voiceChannel) {
          disconnectFromVoice();

          state.voice.channel = message.member.voiceChannel;

          joinAndPlayStream();
        } else {
          message.channel.send("You need to join a voice channel first!");
        }
        break;
      }
      case "leave": {
        disconnectFromVoice();
        break;
      }

      case "play": {
        if (args.length === 0) {
          spotify.play();
        } else {
          if (args[0].startsWith("http")) {
            spotify.playURL(args[0]);
          } else {
            spotify.searchAndPlay(args.join(" "));
          }
        }

        break;
      }
      case "pause": {
        spotify.pause();
        break;
      }
      case "previous": {
        spotify.previous();
        break;
      }
      case "next":
      case "skip": {
        spotify.next();
        break;
      }

      case "radio": {
        spotify.startRadio();
        break;
      }

      case "np":
      case "nowplaying":
      case "info": {
        spotify.nowPlayingInfo().then((info) => {
          message.channel.send("Now Playing: " + info);
        });
        break;
      }

      case "list":
      case "help": {
        message.channel.send(
          [
            "`.spotify join` - Join your voice channel",
            "`.spotify leave` - Leave the voice channel the bot is connected to",
            "`.spotify play http://...` - Play a playlist or album via URL",
            "`.spotify play search term` - Search for a song and play the first result",
            "`.spotify pause` - Pause music playback",
            "`.spotify play` - Resume music playback",
            "`.spotify previous` - Go to the previous track, or the beginning of the current track",
            "`.spotify next`, `.spotify skip` - Go to the next track",
            "`.spotify radio` - Start playing radio from the currently playing song",
            "`.spotify nowplaying`, `.spotify np`, `.spotify info` - Show information about the current track",
            "`.spotify list`, `.spotify help` - Show this command list",
            "`.spotify restart` - Log out of Spotify and back in",
            "`.spotify bitrate` - Get or set the audio stream bitrate",
            "`.spotify exit` - This kills the bot",
          ].join("\n")
        );
        break;
      }

      default: {
        message.channel.send(`No such command: \`${command}\``);
      }
    }
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
