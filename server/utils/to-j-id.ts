type ToJIdOpts = {
  countryCode?: string
  isGroup?: boolean
}
export const toJId = (whatsAppNumber: string | number, opts: ToJIdOpts = {}) => {
  const {
    countryCode = "62",
    isGroup = false,
  } = opts

  if (String(whatsAppNumber).includes("@g.us") || String(whatsAppNumber).includes("@s.whatsapp.net")) {
    return String(whatsAppNumber)
  }

  let _ = String(whatsAppNumber)
  const suffix = isGroup ? "@g.us" : "@s.whatsapp.net"
  const isStartsWithZero = _.startsWith("0")
  if (isStartsWithZero) {
    _ = _.slice(1)
    _ = `${countryCode}${_}`
  }

  return `${_}${suffix}`
}