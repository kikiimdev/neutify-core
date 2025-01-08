export function parseContactId(id: string) {

  let phoneNumber = id
  let jId = id

  // Parse phone number & jId
  if (phoneNumber?.includes(":")) {
    const [_phoneNumber] = phoneNumber.split(":")
    phoneNumber = _phoneNumber

    const [_, suffix] = id.split("@")
    jId = `${_phoneNumber}@${suffix}`
  } else if (phoneNumber?.includes("@")) {
    const [_phoneNumber] = phoneNumber.split("@")
    phoneNumber = _phoneNumber
  }

  return {
    phoneNumber,
    jId
  }
}