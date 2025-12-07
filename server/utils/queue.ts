import amqp, { type Connection, type Channel, connect, type Options } from "amqplib";

let connection: Connection | null = null;
const channels: Map<string, Channel> = new Map();

async function connectRabbit(): Promise<Connection> {
  const config = useRuntimeConfig();
  const url = `amqp://${config.rabbitmq.username}:${config.rabbitmq.password}@${config.rabbitmq.url}:${config.rabbitmq.port}`;

  try {
    if (connection) return connection;

    connection = await amqp.connect(url, {
      heartbeat: 30
    });

    console.log("[RabbitMQ] Connected");

    connection.on("error", err => {
      console.error("[RabbitMQ] Connection error", err);
    });

    connection.on("close", () => {
      console.error("[RabbitMQ] Connection closed. Reconnecting...");
      connection = null;
      channels.clear();
      setTimeout(connectRabbit, 3000);
    });

    return connection;
  } catch (err) {
    console.error("[RabbitMQ] Connect failed, retrying...", err);
    connection = null;
    setTimeout(connectRabbit, 3000);
    throw err;
  }
}

export async function getChannel(id: string): Promise<Channel> {
  const conn = await connectRabbit();

  if (channels.has(id)) {
    return channels.get(id)!;
  }

  const channel = await conn.createChannel();
  channels.set(id, channel);

  channel.on("close", () => {
    console.warn(`[RabbitMQ] Channel ${id} closed, deleting from cache`);
    channels.delete(id);
  });

  return channel;
}


// import { connect, type Connection, type Channel, type ConsumeMessage } from "amqplib"

export const defineQueueConnection = async () => {
  const config = useRuntimeConfig()
  const URL = config.rabbitmq.url
  const PORT = config.rabbitmq.port
  const USERNAME = config.rabbitmq.username
  const PASSWORD = config.rabbitmq.password

  const existingConnection = await useStorage('ampq').getItemRaw<Connection>('connection')
  if (existingConnection) {
    return existingConnection
  }

  // const newConnection = await connect(
  //   `amqp://${USERNAME}:${PASSWORD}@${URL}:${PORT}`,
  // )

  const connectionOptions = {
    protocol: 'amqp',
    hostname: URL,
    port: Number(PORT),
    username: USERNAME,
    password: PASSWORD,
    vhost: '/',
    heartbeat: 30,
  } satisfies Options.Connect;

  const newConnection = await connect(
    connectionOptions
  )

  newConnection.on("error", err => {
    console.error("[RabbitMQ] Connection error", err);
  });

  newConnection.on("close", () => {
    console.error("[RabbitMQ] Connection closed. Reconnecting...");
    connection = null;
    channels.clear();
    setTimeout(defineQueueConnection, 3000);
  });

  await useStorage('ampq').setItemRaw('connection', newConnection)

  return newConnection
}

export const defineQueueChannel = async (connection: Connection, id: string) => {
  const existingChannel = await useStorage(`ampq:${id}`).getItemRaw<Channel>('channel')
  if (existingChannel) {
    return existingChannel
  }
  const newChannel = await connection.createChannel()

  await useStorage(`ampq:${id}`).setItemRaw('channel', newChannel)

  return newChannel
}
