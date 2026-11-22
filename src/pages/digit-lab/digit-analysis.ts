export const getLastDigit = (quote: string | number, pipSize: number): number | null => {
    if (!Number.isFinite(Number(quote)) || !Number.isInteger(pipSize) || pipSize < 0 || pipSize > 20) {
        return null;
    }

    const formattedQuote = Number(quote).toFixed(pipSize);
    const lastCharacter = formattedQuote[formattedQuote.length - 1];
    return lastCharacter && /\d/.test(lastCharacter) ? Number(lastCharacter) : null;
};

export const getDigitCounts = (digits: number[]): number[] => {
    const counts = Array.from({ length: 10 }, () => 0);
    digits.forEach(digit => {
        if (Number.isInteger(digit) && digit >= 0 && digit <= 9) {
            counts[digit] += 1;
        }
    });
    return counts;
};
