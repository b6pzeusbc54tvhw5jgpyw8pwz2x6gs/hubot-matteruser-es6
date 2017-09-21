'use strict'

const MatterMostClient = require('mattermost-client')
const Adapter = require('hubot/src/adapter')
const Message = require('hubot/src/message')
const TextMessage = Message.TextMessage
const EnterMessage = Message.EnterMessage
const LeaveMessage = Message.LeaveMessage

class AttachmentMessage extends TextMessage {

  constructor(user, text, file_ids, id) {
    this.user = user
    this.text = text
    this.file_ids = file_ids
    this.id = id
    super(this.user, this.text, this.id)
  }
}

class Matteruser extends Adapter {
  run() {
    this.open = this.open.bind(this)
    this.onHello = this.onHello.bind(this)
    this.loggedIn = this.loggedIn.bind(this)
    this.onConnected = this.onConnected.bind(this)
    this.message = this.message.bind(this)
    this.profilesLoaded = this.profilesLoaded.bind(this)
    this.userAdded = this.userAdded.bind(this)
    this.userRemoved = this.userRemoved.bind(this)
    this.error = this.error.bind(this)

    let mmHost = process.env.MATTERMOST_HOST
    let mmUser = process.env.MATTERMOST_USER
    let mmPassword = process.env.MATTERMOST_PASSWORD
    let mmGroup = process.env.MATTERMOST_GROUP
    let mmWSSPort = process.env.MATTERMOST_WSS_PORT || '443'
    let mmHTTPPort = process.env.MATTERMOST_HTTP_PORT || null
    this.mmNoReply = process.env.MATTERMOST_REPLY === 'false'
    this.mmIgnoreUsers = (process.env.MATTERMOST_IGNORE_USERS != null ? process.env.MATTERMOST_IGNORE_USERS.split(',') : undefined) || []

    if (mmHost == null) {
      this.robot.logger.emergency("MATTERMOST_HOST is required")
      process.exit(1)
    }
    if (mmUser == null) {
      this.robot.logger.emergency("MATTERMOST_USER is required")
      process.exit(1)
    }
    if (mmPassword == null) {
      this.robot.logger.emergency("MATTERMOST_PASSWORD is required")
      process.exit(1)
    }
    if (mmGroup == null) {
      this.robot.logger.emergency("MATTERMOST_GROUP is required")
      process.exit(1)
    }

    this.client = new MatterMostClient(mmHost, mmGroup, mmUser, mmPassword, {wssPort: mmWSSPort, httpPort: mmHTTPPort, pingInterval: 30000})


    this.client.on('open', this.open)
    this.client.on('hello', this.onHello)
    this.client.on('loggedIn', this.loggedIn)
    this.client.on('connected', this.onConnected)
    this.client.on('message', this.message)
    this.client.on('profilesLoaded', this.profilesLoaded)
    this.client.on('user_added', this.userAdded)
    this.client.on('user_removed', this.userRemoved)
    this.client.on('error', this.error)

    this.robot.brain.on('loaded', this.brainLoaded)

    this.robot.on('slack-attachment', this.slackAttachmentMessage)
    this.robot.on('slack.attachment', this.slackAttachmentMessage)

    return this.client.login()
  }

  open() {
    return true
  }

  error(err) {
    this.robot.logger.info(`Error: ${err}`)
    return true
  }

  onConnected() {
    this.robot.logger.info('Connected to Mattermost.')
    this.emit('connected')
    return true
  }

  onHello(event) {
    this.robot.logger.info(`Mattermost server: ${event.data.server_version}`)
    return true
  }

  userChange(user) {
    let value
    if ((user != null ? user.id : undefined) == null) { return; }
    this.robot.logger.debug(`Adding user ${user.id}`)
    let newUser = {
      name: user.username,
      real_name: `${user.first_name} ${user.last_name}`,
      email_address: user.email,
      mm: {}
    }
    // Preserve the DM channel ID if it exists
    newUser.mm.dm_channel_id = __guard__(this.robot.brain.userForId(user.id).mm, x => x.dm_channel_id)
    for (var key in user) {
      value = user[key]
      newUser.mm[key] = value
    }
    if (user.id in this.robot.brain.data.users) {
      for (key in this.robot.brain.data.users[user.id]) {
        value = this.robot.brain.data.users[user.id][key]
        if (!(key in newUser)) {
          newUser[key] = value
        }
      }
    }
    delete this.robot.brain.data.users[user.id]
    return this.robot.brain.userForId(user.id, newUser)
  }

  loggedIn(user) {
    this.robot.logger.info(`Logged in as user "${user.username}" but not connected yet.`)
    this.self = user
    this.robot.name = this.self.username
    return true
  }

  profilesLoaded() {
    for (let id in this.client.users) {
      let user = this.client.users[id]
      this.userChange(user)
    }
  }

  brainLoaded() {
    this.robot.logger.info('Brain loaded')
    for (let id in this.client.users) {
      let user = this.client.users[id]
      this.userChange(user)
    }
    return true
  }

  send(envelope, ...strings) {
    // Check if the target room is also a user's username
    let str
    let user = this.robot.brain.userForName(envelope.room)

    // If it's not, continue as normal
    if (!user) {
      let channel = this.client.findChannelByName(envelope.room)
      for (str of Array.from(strings)) { this.client.postMessage(str, (channel != null ? channel.id : undefined) || envelope.room); }
      return
    }

    // If it is, we assume they want to DM that user
    // Message their DM channel ID if it already exists.
    if ((user.mm != null ? user.mm.dm_channel_id : undefined) != null) {
      for (str of Array.from(strings)) { this.client.postMessage(str, user.mm.dm_channel_id); }
      return
    }

    // Otherwise, create a new DM channel ID and message it.
    return this.client.getUserDirectMessageChannel(user.id, channel => {
      user.mm.dm_channel_id = channel.id
      return (() => {
        let result = []
        for (str of Array.from(strings)) {           result.push(this.client.postMessage(str, channel.id))
        }
        return result
      })()
    })
  }

  reply(envelope, ...strings) {
    if (this.mmNoReply) {
      return this.send(envelope, ...Array.from(strings))
    }

    strings = strings.map(s => `@${envelope.user.name} ${s}`)
    let postData = {}
    postData.message = strings[0]

    // Set the comment relationship
    postData.root_id = envelope.message.id
    postData.parent_id = postData.root_id

    postData.create_at = Date.now()
    postData.user_id = this.self.id
    postData.filename = []
    // Check if the target room is also a user's username
    let user = this.robot.brain.userForName(envelope.room)

    // If it's not, continue as normal
    if (!user) {
      let channel = this.client.findChannelByName(envelope.room)
      postData.channel_id = (channel != null ? channel.id : undefined) || envelope.room
      this.client.customMessage(postData, postData.channel_id)
      return
    }

    // If it is, we assume they want to DM that user
    // Message their DM channel ID if it already exists.
    if ((user.mm != null ? user.mm.dm_channel_id : undefined) != null) {
      postData.channel_id = user.mm.dm_channel_id
      this.client.customMessage(postData, postData.channel_id)
      return
    }

    // Otherwise, create a new DM channel ID and message it.
    return this.client.getUserDirectMessageChannel(user.id, channel => {
      user.mm.dm_channel_id = channel.id
      postData.channel_id = channel.id
      return this.client.customMessage(postData, postData.channel_id)
    })
  }

  message(msg) {
    if (Array.from(this.mmIgnoreUsers).includes(msg.data.sender_name)) {
      this.robot.logger.info(`User ${msg.data.sender_name} is in MATTERMOST_IGNORE_USERS, ignoring them.`)
      return
    }

    this.robot.logger.debug(msg)
    let mmPost = JSON.parse(msg.data.post)
    let mmUser = this.client.getUserByID(mmPost.user_id)
    if (mmPost.user_id === this.self.id) { return; } // Ignore our own output
    this.robot.logger.debug(`From: ${mmPost.user_id}, To: ${this.self.id}`)

    let user = this.robot.brain.userForId(mmPost.user_id)
    user.room = mmPost.channel_id

    let text = mmPost.message
    if (msg.data.channel_type === 'D') {
      if (!new RegExp(`^@?${this.robot.name}`, 'i').test(text)) { // Direct message
      text = `${this.robot.name} ${text}`
    }
      user.mm.dm_channel_id = mmPost.channel_id
    }
    this.robot.logger.debug(`Text: ${text}`)

    if (mmPost.file_ids != null) {
      this.receive(new AttachmentMessage(user, text, mmPost.file_ids, mmPost.id))
    } else {
      this.receive(new TextMessage(user, text, mmPost.id))
    }
    this.robot.logger.debug("Message sent to hubot brain.")
    return true
  }

  userAdded(msg) {
    let mmUser = this.client.getUserByID(msg.data.user_id)
    this.userChange(mmUser)
    let user = this.robot.brain.userForId(mmUser.id)
    user.room = msg.broadcast.channel_id
    this.receive(new EnterMessage(user))
    return true
  }

  userRemoved(msg) {
    let mmUser = this.client.getUserByID(msg.data.user_id)
    let user = this.robot.brain.userForId(mmUser.id)
    user.room = msg.broadcast.channel_id
    this.receive(new LeaveMessage(user))
    return true
  }

  slackAttachmentMessage(data) {
    if (!data.room) { return; }
    let msg = {}
    msg.text = data.text
    msg.type = "slack_attachment"
    msg.props = {}
    msg.channel_id = data.room
    msg.props.attachments = data.attachments || []
    if (!Array.isArray(msg.props.attachments)) { msg.props.attachments = [msg.props.attachments]; }
    if (data.username && (data.username !== this.robot.name)) {
      msg.as_user = false
      msg.username = data.username
      if (data.icon_url != null) {
        msg.icon_url = data.icon_url
      } else if (data.icon_emoji != null) {
        msg.icon_emoji = data.icon_emoji
      }
    } else {
      msg.as_user = true
    }

    return this.client.customMessage(msg, msg.channel_id)
  }

  changeHeader(channel, header) {
    if (channel == null) { return; }
    if (header == null) { return; }

    let channelInfo = this.client.findChannelByName(channel)

    if (channelInfo == null) { return this.robot.logger.error("Channel not found"); }

    return this.client.setChannelHeader(channelInfo.id, header)
  }
}

exports.use = robot => new Matteruser(robot)

function __guard__(value, transform) {
  return (typeof value !== 'undefined' && value !== null) ? transform(value) : undefined
}
