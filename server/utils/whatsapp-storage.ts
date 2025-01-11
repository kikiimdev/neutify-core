import { type WASocket } from "./whatsapp-socket"
import type { ConnectionState, Contact } from "@whiskeysockets/baileys"

export type DefineWhatsAppStorageCallback<Device> = {
  findDevice: (deviceId: string) => Promise<Device>,
  onConnectionUpdate: (deviceId: string, update: Partial<ConnectionState>) => Promise<void>
  onWhatsAppConnected?: (deviceId: string, whatsAppProfile: Contact) => Promise<void>
}

export async function defineWhatsAppStorage<Device>(callback: DefineWhatsAppStorageCallback<Device>) {
  const _storage = useStorage('whatsapp')

  const defaultStorage = <T>(basePath: string) => {
    return {
      set: async (id: string, value: T) => {
        await _storage.setItemRaw(`${basePath}:${id}`, value as any)
      },
      get: async (id: string) => {
        return _storage.getItemRaw<T>(`${basePath}:${id}`)
      },
      remove: async (id: string) => {
        await _storage.remove(`${basePath}:${id}`)
      }
    }
  }

  const devicePath = 'device'
  const device = {
    get: async (deviceId: string) => {
      try {

        console.log(`finding device ${deviceId}`);
        let existingDevice: Device | null = await _storage.getItemRaw<Device>(`${devicePath}:${deviceId}`)
        console.log({ existingDevice });

        if (!existingDevice) {
          console.log(`device ${deviceId} not found, finding it from db`);
          existingDevice = await callback.findDevice(deviceId)
          if (!existingDevice) {
            return null
          }

          await _storage.setItemRaw(`${devicePath}:${deviceId}`, existingDevice as any)
        }

        return existingDevice

      } catch (error) {
        console.error(error)
        return null
      }
    },
    remove: async (deviceId: string) => {
      await _storage.remove(`${devicePath}:${deviceId}`)
    }
  }

  const socket = {
    ...defaultStorage<WASocket>('socket'),
    onConnectionUpdate: async (deviceId: string, update: Partial<ConnectionState>) => callback.onConnectionUpdate(deviceId, update),
    onWhatsAppConnected: async (deviceId: string, whatsAppProfile: Contact) => callback.onWhatsAppConnected?.(deviceId, whatsAppProfile)
  }

  return {
    device,
    socket
  }
}

export type DefineWhatsAppStorage<Device> = ReturnType<typeof defineWhatsAppStorage<Device>>