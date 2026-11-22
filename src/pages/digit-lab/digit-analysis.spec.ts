import { getDigitCounts, getLastDigit } from './digit-analysis';

describe('digit analysis helpers', () => {
    it('uses the market precision to find the last quote digit', () => {
        expect(getLastDigit('123.450', 3)).toBe(0);
        expect(getLastDigit(123.45, 2)).toBe(5);
        expect(getLastDigit('not-a-quote', 2)).toBeNull();
    });

    it('counts only valid digits', () => {
        expect(getDigitCounts([1, 1, 3, 9, -1, 10])).toEqual([0, 2, 0, 1, 0, 0, 0, 0, 0, 1]);
    });
});
