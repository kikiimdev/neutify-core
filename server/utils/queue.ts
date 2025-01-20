import { connect, type Connection, type Channel, type ConsumeMessage } from "amqplib"

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
  const newConnection = await connect(`amqp://${USERNAME}:${PASSWORD}@${URL}:${PORT}`)
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