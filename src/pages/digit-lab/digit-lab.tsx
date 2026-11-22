import React from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { api_base, ApiHelpers, load } from '@/external/bot-skeleton';
import { save_types } from '@/external/bot-skeleton/constants/save-type';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import { getDigitCounts, getLastDigit } from './digit-analysis';
import alternateEvenOddXml from '@/external/bot-skeleton/examples/xml-examples/misc/Alternate Even-Odd.xml';
import lastDigitMatchXml from '@/external/bot-skeleton/examples/xml-examples/random/last digit demo.xml';
import lastDigitDiffersXml from '@/external/bot-skeleton/examples/xml-examples/random/Use last digit in trade definition.xml';
import predictionSequenceXml from '@/external/bot-skeleton/examples/xml-examples/random/prediction example.xml';
import './digit-lab.scss';

type TDigitSymbol = {
    text: string;
    value: string;
};

type TDigitContract = 'DIGITEVEN' | 'DIGITODD' | 'DIGITOVER' | 'DIGITUNDER' | 'DIGITMATCH' | 'DIGITDIFF';

type TBotTemplate = {
    id: string;
    name: string;
    description: string;
    xml: string;
};

type TApiRecord = Record<string, unknown>;

type TProposal = {
    id: string | number;
    ask_price: number;
    payout?: number;
};

const DIGIT_CONTRACTS: { value: TDigitContract; label: string }[] = [
    { value: 'DIGITEVEN', label: 'Even' },
    { value: 'DIGITODD', label: 'Odd' },
    { value: 'DIGITOVER', label: 'Over' },
    { value: 'DIGITUNDER', label: 'Under' },
    { value: 'DIGITMATCH', label: 'Matches' },
    { value: 'DIGITDIFF', label: 'Differs' },
];

const BOT_TEMPLATES: TBotTemplate[] = [
    {
        id: 'fixed-even-odd',
        name: 'Fixed-stake Even / Odd',
        description: 'A simple Even/Odd example with a fixed stake. Edit the amount and market before running.',
        xml: alternateEvenOddXml,
    },
    {
        id: 'last-digit-match-differ',
        name: 'Last-digit Match / Differ',
        description: 'Checks the last digit and chooses Match or Differ. The prediction is set to 1 in this example.',
        xml: lastDigitMatchXml,
    },
    {
        id: 'last-digit-differs',
        name: 'Last digit — Differs',
        description: 'Uses the latest tick digit as the prediction for a Differ contract.',
        xml: lastDigitDiffersXml,
    },
    {
        id: 'digit-prediction-sequence',
        name: 'Digit prediction sequence',
        description: 'A small editable Match / Differ example that cycles through two prediction digits.',
        xml: predictionSequenceXml,
    },
];

const isRecord = (value: unknown): value is TApiRecord => typeof value === 'object' && value !== null;

const getApiMessage = (error: unknown): string => {
    if (isRecord(error)) {
        const apiError = isRecord(error.error) ? error.error : error;
        if (typeof apiError.message === 'string') return apiError.message;
    }
    return localize('The request could not be completed. Please try again.');
};

const getDigitSymbols = (): TDigitSymbol[] => {
    const symbols = ApiHelpers?.instance?.active_symbols?.getSymbolsForBot?.() ?? [];
    return symbols
        .filter((symbol: TDigitSymbol) => /^(R_\d+|1HZ\d+V)$/i.test(symbol.value))
        .map((symbol: TDigitSymbol) => ({ text: symbol.text, value: symbol.value }));
};

const DigitLab = observer(
    ({ is_active, onOpenBotBuilder }: { is_active: boolean; onOpenBotBuilder: () => void }) => {
        const { client, run_panel } = useStore();
        const [symbols, setSymbols] = React.useState<TDigitSymbol[]>([]);
        const [symbol, setSymbol] = React.useState('');
        const [digits, setDigits] = React.useState<number[]>([]);
        const [lastQuote, setLastQuote] = React.useState('');
        const [scanError, setScanError] = React.useState('');
        const [stake, setStake] = React.useState('1');
        const [duration, setDuration] = React.useState('1');
        const [contractType, setContractType] = React.useState<TDigitContract>('DIGITOVER');
        const [barrier, setBarrier] = React.useState('5');
        const [proposal, setProposal] = React.useState<TProposal | null>(null);
        const [manualStatus, setManualStatus] = React.useState('');
        const [manualError, setManualError] = React.useState('');
        const [isLoadingProposal, setIsLoadingProposal] = React.useState(false);
        const [isBuying, setIsBuying] = React.useState(false);
        const [loadingTemplate, setLoadingTemplate] = React.useState('');
        const isRunning = run_panel.is_running || api_base.is_running;

        React.useEffect(() => {
            const availableSymbols = getDigitSymbols();
            setSymbols(availableSymbols);
            setSymbol(current => current || availableSymbols[0]?.value || '');
        }, []);

        React.useEffect(() => {
            setDigits([]);
            setLastQuote('');
            setScanError('');
            if (!is_active || !symbol) return;

            const api = api_base.api;
            if (!api) {
                setScanError(localize('The market data connection is not ready.'));
                return;
            }

            let isMounted = true;
            let hasHistory = false;
            let subscriptionId: string | undefined;
            const bufferedTicks: number[] = [];
            const pipSize = Number(api_base.pip_sizes?.[symbol] ?? 0);
            const messageSubscription = api.onMessage().subscribe(message => {
                if (!isRecord(message) || !isRecord(message.data)) return;
                const data = message.data;
                if (data.msg_type !== 'tick' || !isRecord(data.tick) || data.tick.symbol !== symbol) return;

                const quote = data.tick.quote;
                if (typeof quote !== 'number' && typeof quote !== 'string') return;
                const digit = getLastDigit(quote, pipSize);
                if (digit === null) return;
                if (!hasHistory) {
                    bufferedTicks.push(digit);
                    return;
                }

                setDigits(current => [...current, digit].slice(-500));
                setLastQuote(String(quote));
            });

            api.send({
                ticks_history: symbol,
                count: 100,
                end: 'latest',
                style: 'ticks',
                subscribe: 1,
            }).then(response => {
                if (!isRecord(response)) throw new Error(localize('No market data was returned.'));
                if (response.error) throw new Error(getApiMessage(response));

                const history = isRecord(response.history) ? response.history : null;
                const prices = Array.isArray(history?.prices) ? history.prices : [];
                const subscription = isRecord(response.subscription) ? response.subscription : null;
                const receivedSubscriptionId =
                    typeof subscription?.id === 'string' ? subscription.id : undefined;
                if (!isMounted) {
                    if (receivedSubscriptionId) {
                        void api.send({ forget: receivedSubscriptionId }).catch(error => {
                            console.error('Unable to unsubscribe from digit scanner ticks:', error);
                        });
                    }
                    return;
                }

                const historyDigits = prices
                    .map(price => (typeof price === 'string' || typeof price === 'number' ? getLastDigit(price, pipSize) : null))
                    .filter((digit): digit is number => digit !== null);
                const nextDigits = [...historyDigits, ...bufferedTicks].slice(-500);
                hasHistory = true;
                setDigits(nextDigits);
                setLastQuote(prices.length ? String(prices[prices.length - 1]) : '');
                subscriptionId = receivedSubscriptionId;
            }).catch(error => {
                if (isMounted) setScanError(getApiMessage(error));
            });

            return () => {
                isMounted = false;
                messageSubscription.unsubscribe();
                if (subscriptionId) {
                    void api.send({ forget: subscriptionId }).catch(error => {
                        console.error('Unable to unsubscribe from digit scanner ticks:', error);
                    });
                }
            };
        }, [is_active, symbol]);

        const counts = React.useMemo(() => getDigitCounts(digits), [digits]);
        const mostFrequentDigit = counts.reduce((best, count, index) => (count > counts[best] ? index : best), 0);
        const hasBarrier = ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(contractType);
        const amount = Number(stake);
        const durationInTicks = Number(duration);
        const barrierDigit = Number(barrier);
        const minimumBarrier = contractType === 'DIGITUNDER' ? 1 : 0;
        const maximumBarrier = contractType === 'DIGITOVER' ? 8 : 9;
        const barrierIsValid =
            !hasBarrier ||
            (Number.isInteger(barrierDigit) &&
                barrierDigit >= minimumBarrier &&
                barrierDigit <= maximumBarrier);
        const canRequestProposal =
            !!symbol &&
            client.is_logged_in &&
            api_base.is_authorized &&
            !isRunning &&
            Number.isFinite(amount) &&
            amount >= 0.35 &&
            Number.isInteger(durationInTicks) &&
            durationInTicks >= 1 &&
            durationInTicks <= 10 &&
            barrierIsValid;

        const onContractTypeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
            const value = event.target.value as TDigitContract;
            setContractType(value);
            setProposal(null);
            setManualError('');
            setManualStatus('');
            if (value === 'DIGITOVER') setBarrier('5');
            if (value === 'DIGITUNDER') setBarrier('4');
        };

        const requestProposal = async (event: React.FormEvent) => {
            event.preventDefault();
            setProposal(null);
            setManualStatus('');
            setManualError('');

            if (!client.is_logged_in || !api_base.is_authorized || !api_base.api) {
                setManualError(localize('Log in to your Deriv account before requesting a price.'));
                return;
            }
            if (isRunning) {
                setManualError(localize('Stop the running bot before placing a manual trade.'));
                return;
            }
            if (!canRequestProposal) {
                setManualError(localize('Check the stake, duration, market, and digit prediction.'));
                return;
            }

            const proposalRequest: TApiRecord = {
                proposal: 1,
                amount,
                basis: 'stake',
                contract_type: contractType,
                currency: client.currency,
                duration: durationInTicks,
                duration_unit: 't',
                underlying_symbol: symbol,
            };
            if (hasBarrier) proposalRequest.barrier = barrierDigit;

            setIsLoadingProposal(true);
            try {
                const response = await api_base.api.send(proposalRequest);
                if (!isRecord(response)) throw new Error(localize('No price was returned.'));
                if (response.error) throw new Error(getApiMessage(response));
                const proposalData = isRecord(response.proposal) ? response.proposal : null;
                const id = proposalData?.id;
                const askPrice = Number(proposalData?.ask_price);
                if ((typeof id !== 'string' && typeof id !== 'number') || !Number.isFinite(askPrice)) {
                    throw new Error(localize('The market returned an invalid price. Please request a new price.'));
                }
                setProposal({
                    id,
                    ask_price: askPrice,
                    payout: typeof proposalData?.payout === 'number' ? proposalData.payout : undefined,
                });
            } catch (error) {
                setManualError(getApiMessage(error));
            } finally {
                setIsLoadingProposal(false);
            }
        };

        const confirmBuy = async () => {
            if (!proposal || !api_base.api || !client.is_logged_in || !api_base.is_authorized || isRunning) return;
            if (
                !client.is_virtual &&
                !window.confirm(
                    localize('This trade will use real funds from your selected account. Do you want to continue?')
                )
            ) {
                return;
            }

            setIsBuying(true);
            setManualError('');
            setManualStatus('');
            try {
                const response = await api_base.api.send({ buy: proposal.id, price: proposal.ask_price });
                if (!isRecord(response)) throw new Error(localize('No trade confirmation was returned.'));
                if (response.error) throw new Error(getApiMessage(response));
                const buy = isRecord(response.buy) ? response.buy : null;
                if (typeof buy?.contract_id !== 'number' && typeof buy?.contract_id !== 'string') {
                    throw new Error(localize('The trade could not be confirmed by the market.'));
                }
                setManualStatus(
                    localize('Trade placed. Contract ID: {{ contract_id }}', {
                        contract_id: String(buy.contract_id),
                    })
                );
                setProposal(null);
            } catch (error) {
                setManualError(getApiMessage(error));
            } finally {
                setIsBuying(false);
            }
        };

        const loadTemplate = async (template: TBotTemplate) => {
            if (api_base.is_running) {
                setManualError(localize('Stop the running bot before loading another strategy.'));
                return;
            }

            const workspace = window.Blockly?.derivWorkspace;
            if (!workspace) {
                setManualError(localize('The Bot Builder workspace is not ready yet.'));
                return;
            }

            setLoadingTemplate(template.id);
            setManualError('');
            try {
                const xmlDom = window.Blockly.utils.xml.textToDom(template.xml);
                xmlDom.querySelectorAll('field[name="SYMBOL_LIST"]').forEach((field: Element) => {
                    field.textContent = symbol || 'R_100';
                });
                xmlDom.querySelectorAll('field[name="CURRENCY_LIST"]').forEach((field: Element) => {
                    field.textContent = client.currency || 'USD';
                });

                const result = await load({
                    block_string: window.Blockly.Xml.domToText(xmlDom),
                    file_name: template.name,
                    workspace,
                    from: save_types.UNSAVED,
                    drop_event: null,
                    strategy_id: null,
                    showIncompatibleStrategyDialog: false,
                });
                if (isRecord(result) && result.error) {
                    setManualError(getApiMessage(result.error));
                    return;
                }
                onOpenBotBuilder();
            } catch (error) {
                setManualError(getApiMessage(error));
            } finally {
                setLoadingTemplate('');
            }
        };

        return (
            <div className='digit-lab'>
                <header className='digit-lab__header'>
                    <div>
                        <h2>{localize('Digit Lab')}</h2>
                        <p>
                            {localize(
                                'Analyze recent digit ticks, request a manual trade price, or load a free Blockly example.'
                            )}
                        </p>
                    </div>
                    <label className='digit-lab__market'>
                        <span>{localize('Market')}</span>
                        <select
                            aria-label={localize('Market')}
                            onChange={event => {
                                setSymbol(event.target.value);
                                setProposal(null);
                                setManualStatus('');
                            }}
                            value={symbol}
                            disabled={!symbols.length}
                        >
                            {symbols.map(item => (
                                <option key={item.value} value={item.value}>
                                    {item.text} ({item.value})
                                </option>
                            ))}
                        </select>
                    </label>
                </header>

                {!symbols.length && (
                    <p className='digit-lab__notice' role='status'>
                        {localize('No digit markets are currently available on this account.')}
                    </p>
                )}

                <div className='digit-lab__grid'>
                    <section className='digit-lab__card'>
                        <div className='digit-lab__card-heading'>
                            <div>
                                <h3>{localize('AI Scanner')}</h3>
                                <p>{localize('Signal-only digit analysis')}</p>
                            </div>
                            <span className='digit-lab__badge'>{localize('No auto-trades')}</span>
                        </div>
                        <p className='digit-lab__disclaimer'>
                            {localize(
                                'This version reports recent digit frequency from live market data. It does not use an external AI model or predict the next tick.'
                            )}
                        </p>
                        {scanError ? (
                            <p className='digit-lab__error' role='alert'>
                                {scanError}
                            </p>
                        ) : (
                            <>
                                <div className='digit-lab__summary'>
                                    <span>
                                        {localize('Ticks analyzed')}: <strong>{digits.length}</strong>
                                    </span>
                                    <span>
                                        {localize('Latest price')}: <strong>{lastQuote || '—'}</strong>
                                    </span>
                                    {digits.length > 0 && (
                                        <span>
                                            {localize('Most frequent recently')}: <strong>{mostFrequentDigit}</strong>
                                        </span>
                                    )}
                                </div>
                                <div className='digit-lab__digit-list' aria-label={localize('Digit frequency')}>
                                    {counts.map((count, digit) => {
                                        const percentage = digits.length ? (count / digits.length) * 100 : 0;
                                        return (
                                            <div className='digit-lab__digit-row' key={digit}>
                                                <span>{digit}</span>
                                                <div
                                                    className='digit-lab__bar-track'
                                                    aria-label={localize('Digit {{ digit }} frequency', { digit })}
                                                >
                                                    <div
                                                        className='digit-lab__bar'
                                                        style={{ width: `${percentage}%` }}
                                                    />
                                                </div>
                                                <span>{percentage.toFixed(1)}%</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </>
                        )}
                        <p className='digit-lab__footnote'>
                            {localize('Recent frequency is descriptive only; it is not a guarantee or trade signal.')}
                        </p>
                    </section>

                    <section className='digit-lab__card'>
                        <div className='digit-lab__card-heading'>
                            <div>
                                <h3>{localize('Manual Trading')}</h3>
                                <p>{localize('Even, Odd, Over, Under, Matches, or Differs')}</p>
                            </div>
                            <span className='digit-lab__badge'>
                                {client.is_logged_in
                                    ? client.is_virtual
                                        ? localize('Demo account')
                                        : localize('Real account')
                                    : localize('Log in required')}
                            </span>
                        </div>
                        <form className='digit-lab__form' onSubmit={requestProposal}>
                            <label>
                                <span>{localize('Contract')}</span>
                                <select value={contractType} onChange={onContractTypeChange}>
                                    {DIGIT_CONTRACTS.map(item => (
                                        <option key={item.value} value={item.value}>
                                            {localize(item.label)}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            {hasBarrier && (
                                <label>
                                    <span>{localize('Prediction digit / barrier')}</span>
                                    <select
                                        value={barrier}
                                        onChange={event => {
                                            setBarrier(event.target.value);
                                            setProposal(null);
                                        }}
                                    >
                                        {Array.from({ length: 10 }, (_, digit) => digit)
                                            .filter(
                                                digit => contractType !== 'DIGITOVER' || digit <= 8
                                            )
                                            .filter(
                                                digit =>
                                                    digit >= minimumBarrier
                                            )
                                            .map(digit => (
                                                <option key={digit} value={digit}>
                                                    {digit}
                                                </option>
                                            ))}
                                    </select>
                                </label>
                            )}
                            <label>
                                <span>{localize('Stake')} ({client.currency})</span>
                                <input
                                    min='0.35'
                                    step='0.01'
                                    type='number'
                                    value={stake}
                                    onChange={event => {
                                        setStake(event.target.value);
                                        setProposal(null);
                                        setManualStatus('');
                                    }}
                                />
                            </label>
                            <label>
                                <span>{localize('Duration (ticks)')}</span>
                                <input
                                    min='1'
                                    max='10'
                                    step='1'
                                    type='number'
                                    value={duration}
                                    onChange={event => {
                                        setDuration(event.target.value);
                                        setProposal(null);
                                        setManualStatus('');
                                    }}
                                />
                            </label>
                            <button
                                className='digit-lab__button'
                                disabled={!canRequestProposal || isLoadingProposal || isBuying}
                                type='submit'
                            >
                                {isLoadingProposal ? localize('Getting price…') : localize('Get price')}
                            </button>
                        </form>
                        {!client.is_logged_in && (
                            <p className='digit-lab__notice'>{localize('Log in to request a manual trade price.')}</p>
                        )}
                        {isRunning && (
                            <p className='digit-lab__notice'>
                                {localize('Stop the running bot before placing a manual trade.')}
                            </p>
                        )}
                        {proposal && (
                            <div className='digit-lab__proposal'>
                                <p>
                                    {localize('Price')}: <strong>{proposal.ask_price.toFixed(2)} {client.currency}</strong>
                                </p>
                                {proposal.payout !== undefined && (
                                    <p>
                                        {localize('Potential payout')}: {proposal.payout.toFixed(2)} {client.currency}
                                    </p>
                                )}
                                <button
                                    className='digit-lab__button digit-lab__button--confirm'
                                    disabled={isBuying || isRunning}
                                    onClick={confirmBuy}
                                    type='button'
                                >
                                    {isBuying
                                        ? localize('Placing trade…')
                                        : localize('Confirm & buy for {{ price }} {{ currency }}', {
                                              price: proposal.ask_price.toFixed(2),
                                              currency: client.currency,
                                          })}
                                </button>
                            </div>
                        )}
                        {manualError && (
                            <p className='digit-lab__error' role='alert'>
                                {manualError}
                            </p>
                        )}
                        {manualStatus && (
                            <p className='digit-lab__success' role='status'>
                                {manualStatus}
                            </p>
                        )}
                        <p className='digit-lab__footnote'>
                            {localize('Review the price before confirming. Trading can result in loss of your stake.')}
                        </p>
                    </section>
                </div>

                <section className='digit-lab__card digit-lab__bots'>
                    <div className='digit-lab__card-heading'>
                        <div>
                            <h3>{localize('Free Blockly bots')}</h3>
                            <p>{localize('Load an editable XML example into the Deriv Bot Builder.')}</p>
                        </div>
                        <span className='digit-lab__badge'>{localize('4 examples')}</span>
                    </div>
                    <div className='digit-lab__bot-list'>
                        {BOT_TEMPLATES.map(template => (
                            <article className='digit-lab__bot' key={template.id}>
                                <h4>{localize(template.name)}</h4>
                                <p>{localize(template.description)}</p>
                                <button
                                    className={classNames('digit-lab__button', 'digit-lab__button--secondary')}
                                    disabled={!!loadingTemplate || isRunning}
                                    onClick={() => void loadTemplate(template)}
                                    type='button'
                                >
                                    {loadingTemplate === template.id
                                        ? localize('Loading…')
                                        : localize('Load in Bot Builder')}
                                </button>
                            </article>
                        ))}
                    </div>
                    <p className='digit-lab__footnote'>
                        {localize(
                            'Loading a bot only places its blocks in the workspace; it does not start trading. Review and test each strategy, preferably on a demo account.'
                        )}
                    </p>
                </section>
            </div>
        );
    }
);

export default DigitLab;
