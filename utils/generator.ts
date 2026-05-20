/**
 * Generates a random phone number with the specified country code. The phone number consists of 9 random digits.
 * @param countryCode - The country code to prepend to the generated phone number. Defaults to "+61" if not provided.
 * @returns A string representing the generated phone number with the country code.
 */
export const randomPhoneNumberGenerator = (
  countryCode: string = "+61"
): string => {
  // Seed using current time
  let seed = Date.now();

  const seededRandom = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  // Generate 9 random digits
  const number = Array.from({ length: 9 }, () =>
    Math.floor(seededRandom() * 10)
  ).join("");

  return `${countryCode}${number}`;
};