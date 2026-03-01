/**
 * Weather Dashboard CLI
 *
 * Renders a weather dashboard using terminui widgets.
 * Data source: Open-Meteo (no API key required).
 *
 * Run:
 *   npx tsx examples/weather-dashboard.ts --city "New York"
 *   npx tsx examples/weather-dashboard.ts London --units fahrenheit
 */
import {
	Color,
	Modifier,
	blockBordered,
	createLayout,
	createParagraph,
	createRow,
	createSparkline,
	createStyle,
	createTable,
	createTabs,
	createTerminal,
	createTestBackend,
	createTestBackendState,
	createTitle,
	fillConstraint,
	frameRenderWidget,
	gaugePercent,
	lengthConstraint,
	renderGauge,
	renderParagraph,
	renderSparkline,
	renderTable,
	renderTabs,
	splitLayout,
	styleAddModifier,
	styleFg,
	terminalDraw,
	terminalResize,
	testBackendToString,
} from '../src/index';
import type {
	Backend,
	Cell,
	Frame,
	NamedColorType,
	Position,
	Size,
	TestBackendState,
} from '../src/index';

type TemperatureUnit = 'celsius' | 'fahrenheit';

interface CliOptions {
	city: string;
	units: TemperatureUnit;
	width: number;
	height: number;
	refreshSeconds: number;
	fps: number;
	once: boolean;
}

interface GeocodeResult {
	name: string;
	latitude: number;
	longitude: number;
	country?: string;
	admin1?: string;
	timezone?: string;
}

interface GeocodeResponse {
	results?: GeocodeResult[];
}

interface WeatherResponse {
	timezone: string;
	current: {
		time: string;
		temperature_2m: number;
		apparent_temperature: number;
		relative_humidity_2m: number;
		precipitation: number;
		weather_code: number;
		wind_speed_10m: number;
		wind_direction_10m: number;
	};
	hourly: {
		time: string[];
		temperature_2m: number[];
		precipitation_probability: number[];
		wind_speed_10m: number[];
		relative_humidity_2m: number[];
	};
	daily: {
		time: string[];
		weather_code: number[];
		temperature_2m_max: number[];
		temperature_2m_min: number[];
		precipitation_probability_max: number[];
	};
}

interface HourlyPoint {
	time: string;
	temperature: number;
	rainChance: number;
	windSpeed: number;
}

interface DailyPoint {
	date: string;
	max: number;
	min: number;
	rainChance: number;
	weatherCode: number;
}

interface DashboardData {
	locationLabel: string;
	timezone: string;
	temperatureUnit: 'C' | 'F';
	windUnit: 'km/h' | 'mph';
	precipUnit: 'mm' | 'in';
	current: {
		time: string;
		temperature: number;
		feelsLike: number;
		humidity: number;
		precipitation: number;
		weatherCode: number;
		windSpeed: number;
		windDirection: number;
	};
	nextHours: HourlyPoint[];
	nextDays: DailyPoint[];
	sparklineSeries: number[];
}

interface LiveRuntime {
	now: Date;
	tick: number;
	refreshSeconds: number;
	nextRefreshSeconds: number;
	loading: boolean;
	lastUpdatedAt?: Date;
	errorMessage?: string;
}

const DEFAULT_CITY = 'New York';
const DEFAULT_WIDTH = Math.max(80, process.stdout.columns ?? 100);
const DEFAULT_HEIGHT = Math.max(28, process.stdout.rows ?? 30);
const DEFAULT_REFRESH_SECONDS = 600;
const DEFAULT_FPS = 6;

const clamp = (value: number, min: number, max: number): number =>
	Math.max(min, Math.min(max, value));

const supportsAnsiColor = (): boolean =>
	process.stdout.isTTY === true && process.env.NO_COLOR === undefined;

const NAMED_ANSI_CODES: Record<Exclude<NamedColorType, 'reset'>, { fg: string; bg: string }> = {
	black: { fg: '30', bg: '40' },
	red: { fg: '31', bg: '41' },
	green: { fg: '32', bg: '42' },
	yellow: { fg: '33', bg: '43' },
	blue: { fg: '34', bg: '44' },
	magenta: { fg: '35', bg: '45' },
	cyan: { fg: '36', bg: '46' },
	gray: { fg: '37', bg: '47' },
	white: { fg: '97', bg: '107' },
	'dark-gray': { fg: '90', bg: '100' },
	'light-red': { fg: '91', bg: '101' },
	'light-green': { fg: '92', bg: '102' },
	'light-yellow': { fg: '93', bg: '103' },
	'light-blue': { fg: '94', bg: '104' },
	'light-magenta': { fg: '95', bg: '105' },
	'light-cyan': { fg: '96', bg: '106' },
};

const serializeColor = (color: Cell['fg'] | Cell['underlineColor'] | undefined): string => {
	if (color === undefined) {
		return 'none';
	}
	switch (color.type) {
		case 'indexed':
			return `idx:${color.index}`;
		case 'rgb':
			return `rgb:${color.r},${color.g},${color.b}`;
		default:
			return color.type;
	}
};

const colorToAnsiParts = (
	color: Cell['fg'] | Cell['underlineColor'] | undefined,
	mode: 'fg' | 'bg' | 'underline',
): string[] => {
	if (color === undefined) {
		return [];
	}

	if (color.type === 'indexed') {
		return mode === 'underline'
			? ['58', '5', String(color.index)]
			: [mode === 'fg' ? '38' : '48', '5', String(color.index)];
	}

	if (color.type === 'rgb') {
		return mode === 'underline'
			? ['58', '2', String(color.r), String(color.g), String(color.b)]
			: [mode === 'fg' ? '38' : '48', '2', String(color.r), String(color.g), String(color.b)];
	}

	if (color.type === 'reset') {
		if (mode === 'fg') return ['39'];
		if (mode === 'bg') return ['49'];
		return ['59'];
	}

	if (mode === 'underline') {
		return [];
	}

	const ansi = NAMED_ANSI_CODES[color.type];
	return [mode === 'fg' ? ansi.fg : ansi.bg];
};

const modifierToAnsiParts = (modifier: number): string[] => {
	const parts: string[] = [];
	if ((modifier & Modifier.BOLD) !== 0) parts.push('1');
	if ((modifier & Modifier.DIM) !== 0) parts.push('2');
	if ((modifier & Modifier.ITALIC) !== 0) parts.push('3');
	if ((modifier & Modifier.UNDERLINED) !== 0) parts.push('4');
	if ((modifier & Modifier.SLOW_BLINK) !== 0) parts.push('5');
	if ((modifier & Modifier.RAPID_BLINK) !== 0) parts.push('6');
	if ((modifier & Modifier.REVERSED) !== 0) parts.push('7');
	if ((modifier & Modifier.HIDDEN) !== 0) parts.push('8');
	if ((modifier & Modifier.CROSSED_OUT) !== 0) parts.push('9');
	if ((modifier & Modifier.DOUBLE_UNDERLINED) !== 0) parts.push('21');
	if ((modifier & Modifier.OVERLINED) !== 0) parts.push('53');
	return parts;
};

const cellStyleKey = (cell: Cell): string =>
	`${serializeColor(cell.fg)}|${serializeColor(cell.bg)}|${serializeColor(cell.underlineColor)}|${cell.modifier}`;

const cellStyleToAnsi = (cell: Cell): string => {
	const parts = [
		...colorToAnsiParts(cell.fg, 'fg'),
		...colorToAnsiParts(cell.bg, 'bg'),
		...colorToAnsiParts(cell.underlineColor, 'underline'),
		...modifierToAnsiParts(cell.modifier),
	];
	return parts.length > 0 ? `\x1b[0;${parts.join(';')}m` : '\x1b[0m';
};

const testBackendToAnsi = (state: TestBackendState): string => {
	const lines: string[] = [];
	for (const row of state.buffer) {
		let line = '';
		let previousStyleKey = '';

		for (const cell of row) {
			const styleKey = cellStyleKey(cell);
			if (styleKey !== previousStyleKey) {
				line += cellStyleToAnsi(cell);
				previousStyleKey = styleKey;
			}
			if (cell.symbol.length > 0) {
				line += cell.symbol;
			}
		}

		lines.push(`${line}\x1b[0m`);
	}
	return lines.join('\n');
};

const weatherAccentColor = (code: number): Cell['fg'] => {
	if (code >= 95) return Color.LightRed;
	if (code === 0 || code === 1) return Color.LightYellow;
	if (code >= 2 && code <= 3) return Color.Gray;
	if ((code >= 45 && code <= 57) || (code >= 61 && code <= 67) || (code >= 80 && code <= 82)) {
		return Color.LightBlue;
	}
	if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
		return Color.White;
	}
	return Color.LightCyan;
};

const SPINNER_FRAMES = ['-', '\\', '|', '/'] as const;

const spinnerFrame = (tick: number): string => SPINNER_FRAMES[tick % SPINNER_FRAMES.length] ?? '-';

const formatClock = (date: Date, timeZone: string): string =>
	date.toLocaleTimeString('en-US', {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false,
		timeZone,
	});

const formatAgeSeconds = (now: Date, then?: Date): string => {
	if (then === undefined) {
		return 'n/a';
	}
	const seconds = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 1000));
	return `${seconds}s ago`;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const createNodeBackend = (): Backend => {
	let cursor: Position = { x: 0, y: 0 };

	return {
		size: (): Size => ({
			width: Math.max(20, process.stdout.columns ?? 80),
			height: Math.max(10, process.stdout.rows ?? 24),
		}),

		draw: (content): void => {
			if (content.length === 0) {
				return;
			}

			let output = '';
			let lastStyle = '';

			for (const { x, y, cell } of content) {
				if (x < 0 || y < 0) {
					continue;
				}

				output += `\x1b[${y + 1};${x + 1}H`;
				const style = cellStyleToAnsi(cell);
				if (style !== lastStyle) {
					output += style;
					lastStyle = style;
				}
				output += cell.symbol.length > 0 ? cell.symbol : ' ';
			}

			output += '\x1b[0m';
			process.stdout.write(output);
		},

		flush: (): void => {},

		hideCursor: (): void => {
			process.stdout.write('\x1b[?25l');
		},

		showCursor: (): void => {
			process.stdout.write('\x1b[?25h');
		},

		getCursorPosition: (): Position => cursor,

		setCursorPosition: (pos: Position): void => {
			cursor = pos;
			process.stdout.write(`\x1b[${pos.y + 1};${pos.x + 1}H`);
		},

		clear: (): void => {
			process.stdout.write('\x1b[2J\x1b[H');
		},
	};
};

const enterAlternateScreen = (): void => {
	process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H\x1b[?25l');
};

const exitAlternateScreen = (): void => {
	process.stdout.write('\x1b[0m\x1b[?25h\x1b[?1049l');
};

const attachQuitKeyListener = (onQuit: () => void): (() => void) => {
	if (process.stdin.isTTY !== true || typeof process.stdin.setRawMode !== 'function') {
		return () => {};
	}

	process.stdin.setRawMode(true);
	process.stdin.resume();
	process.stdin.setEncoding('utf8');

	const onData = (chunk: string): void => {
		if (chunk === 'q' || chunk === 'Q' || chunk === '\u0003') {
			onQuit();
		}
	};

	process.stdin.on('data', onData);

	return (): void => {
		process.stdin.off('data', onData);
		process.stdin.setRawMode(false);
		process.stdin.pause();
	};
};

const parseNumber = (value: string, flag: string): number => {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed)) {
		throw new Error(`Invalid value for ${flag}: ${value}`);
	}
	return parsed;
};

const readNextArg = (args: string[], index: number, flag: string): string => {
	const value = args[index + 1];
	if (value === undefined || value.startsWith('-')) {
		throw new Error(`Missing value for ${flag}`);
	}
	return value;
};

const parseCliOptions = (args: string[]): CliOptions => {
	let cityFromFlag: string | undefined;
	const positional: string[] = [];
	let units: TemperatureUnit = 'celsius';
	let width = DEFAULT_WIDTH;
	let height = DEFAULT_HEIGHT;
	let refreshSeconds = DEFAULT_REFRESH_SECONDS;
	let fps = DEFAULT_FPS;
	let once = false;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === undefined) {
			continue;
		}

		if (arg === '--city' || arg === '-c') {
			cityFromFlag = readNextArg(args, i, arg);
			i++;
			continue;
		}

		if (arg === '--units' || arg === '-u') {
			const value = readNextArg(args, i, arg).toLowerCase();
			if (value === 'c' || value === 'celsius') {
				units = 'celsius';
			} else if (value === 'f' || value === 'fahrenheit') {
				units = 'fahrenheit';
			} else {
				throw new Error(`Invalid units: ${value} (use celsius|fahrenheit)`);
			}
			i++;
			continue;
		}

		if (arg === '--width' || arg === '-w') {
			width = parseNumber(readNextArg(args, i, arg), arg);
			i++;
			continue;
		}

		if (arg === '--height' || arg === '-hgt') {
			height = parseNumber(readNextArg(args, i, arg), arg);
			i++;
			continue;
		}

		if (arg === '--refresh' || arg === '-r') {
			refreshSeconds = parseNumber(readNextArg(args, i, arg), arg);
			i++;
			continue;
		}

		if (arg === '--fps') {
			fps = parseNumber(readNextArg(args, i, arg), arg);
			i++;
			continue;
		}

		if (arg === '--once') {
			once = true;
			continue;
		}

		if (arg === '--help' || arg === '-h') {
			printHelp();
			process.exit(0);
		}

		if (arg.startsWith('-')) {
			throw new Error(`Unknown flag: ${arg}`);
		}

		positional.push(arg);
	}

	const city = cityFromFlag ?? (positional.length > 0 ? positional.join(' ') : DEFAULT_CITY);

	return {
		city,
		units,
		width: clamp(width, 80, 220),
		height: clamp(height, 24, 70),
		refreshSeconds: clamp(refreshSeconds, 15, 3600),
		fps: clamp(fps, 1, 30),
		once,
	};
};

const printHelp = (): void => {
	console.log(`Weather Dashboard CLI (terminui example)

Usage:
  npx tsx examples/weather-dashboard.ts [city] [options]

Options:
  -c, --city <name>            City name (default: ${DEFAULT_CITY})
  -u, --units <celsius|fahrenheit>
                               Temperature units (default: celsius)
  -w, --width <columns>        Dashboard width (default: terminal width)
  -hgt, --height <rows>        Dashboard height (default: terminal height)
  -r, --refresh <seconds>      Weather refresh interval (default: ${DEFAULT_REFRESH_SECONDS})
  --fps <frames>               UI frame rate for animation (default: ${DEFAULT_FPS})
  --once                       Render once (no live animation loop)
  -h, --help                   Show this help

Examples:
  npx tsx examples/weather-dashboard.ts "San Francisco"
  npx tsx examples/weather-dashboard.ts London --units fahrenheit --refresh 300
  npx tsx examples/weather-dashboard.ts --city "New York" --once
`);
};

const weatherLabel = (code: number): string => {
	switch (code) {
		case 0:
			return 'Clear';
		case 1:
			return 'Mainly clear';
		case 2:
			return 'Partly cloudy';
		case 3:
			return 'Overcast';
		case 45:
		case 48:
			return 'Fog';
		case 51:
		case 53:
		case 55:
			return 'Drizzle';
		case 56:
		case 57:
			return 'Freezing drizzle';
		case 61:
		case 63:
		case 65:
			return 'Rain';
		case 66:
		case 67:
			return 'Freezing rain';
		case 71:
		case 73:
		case 75:
			return 'Snow';
		case 77:
			return 'Snow grains';
		case 80:
		case 81:
		case 82:
			return 'Rain showers';
		case 85:
		case 86:
			return 'Snow showers';
		case 95:
			return 'Thunderstorm';
		case 96:
		case 99:
			return 'Thunderstorm + hail';
		default:
			return `Code ${code}`;
	}
};

const formatHour = (isoTime: string): string => {
	const hourText = isoTime.slice(11, 13);
	const hour24 = Number.parseInt(hourText, 10);
	if (!Number.isFinite(hour24)) {
		return isoTime;
	}
	const period = hour24 >= 12 ? 'PM' : 'AM';
	const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
	return `${hour12}${period}`;
};

const formatDay = (isoDate: string): string => {
	const date = new Date(`${isoDate}T00:00:00Z`);
	return date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
};

const fetchJson = async <T>(url: string): Promise<T> => {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Request failed (${response.status}) for ${url}`);
	}
	return (await response.json()) as T;
};

const findLocation = async (city: string): Promise<GeocodeResult> => {
	const params = new URLSearchParams({
		name: city,
		count: '1',
		language: 'en',
		format: 'json',
	});
	const url = `https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`;
	const data = await fetchJson<GeocodeResponse>(url);

	const first = data.results?.[0];
	if (first === undefined) {
		throw new Error(`No location found for "${city}"`);
	}
	return first;
};

const fetchWeather = async (
	location: GeocodeResult,
	units: TemperatureUnit,
): Promise<WeatherResponse> => {
	const temperatureUnit = units === 'fahrenheit' ? 'fahrenheit' : 'celsius';
	const windSpeedUnit = units === 'fahrenheit' ? 'mph' : 'kmh';
	const precipitationUnit = units === 'fahrenheit' ? 'inch' : 'mm';

	const params = new URLSearchParams({
		latitude: String(location.latitude),
		longitude: String(location.longitude),
		timezone: 'auto',
		temperature_unit: temperatureUnit,
		wind_speed_unit: windSpeedUnit,
		precipitation_unit: precipitationUnit,
		forecast_days: '7',
		current: [
			'temperature_2m',
			'apparent_temperature',
			'relative_humidity_2m',
			'precipitation',
			'weather_code',
			'wind_speed_10m',
			'wind_direction_10m',
		].join(','),
		hourly: [
			'temperature_2m',
			'precipitation_probability',
			'wind_speed_10m',
			'relative_humidity_2m',
		].join(','),
		daily: [
			'weather_code',
			'temperature_2m_max',
			'temperature_2m_min',
			'precipitation_probability_max',
		].join(','),
	});

	const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
	return fetchJson<WeatherResponse>(url);
};

const sliceHourlyPoints = (weather: WeatherResponse): HourlyPoint[] => {
	const currentIndex = weather.hourly.time.indexOf(weather.current.time);
	const start = currentIndex >= 0 ? currentIndex : 0;
	const points: HourlyPoint[] = [];

	for (let i = start; i < start + 24 && i < weather.hourly.time.length; i++) {
		points.push({
			time: weather.hourly.time[i] ?? '',
			temperature: weather.hourly.temperature_2m[i] ?? 0,
			rainChance: weather.hourly.precipitation_probability[i] ?? 0,
			windSpeed: weather.hourly.wind_speed_10m[i] ?? 0,
		});
	}

	return points;
};

const sliceDailyPoints = (weather: WeatherResponse): DailyPoint[] => {
	const points: DailyPoint[] = [];

	for (let i = 0; i < 5 && i < weather.daily.time.length; i++) {
		points.push({
			date: weather.daily.time[i] ?? '',
			max: weather.daily.temperature_2m_max[i] ?? 0,
			min: weather.daily.temperature_2m_min[i] ?? 0,
			rainChance: weather.daily.precipitation_probability_max[i] ?? 0,
			weatherCode: weather.daily.weather_code[i] ?? 0,
		});
	}

	return points;
};

const buildDashboardData = (
	location: GeocodeResult,
	weather: WeatherResponse,
	units: TemperatureUnit,
): DashboardData => {
	const nextHours = sliceHourlyPoints(weather);
	const nextDays = sliceDailyPoints(weather);

	const rawSeries = nextHours.slice(0, 24).map((hour) => hour.temperature);
	const sparklineSeries = (() => {
		if (rawSeries.length === 0) {
			return [1];
		}
		const minValue = rawSeries.reduce((min, value) => Math.min(min, value), rawSeries[0] ?? 0);
		return rawSeries.map((value) => value - minValue + 1);
	})();

	const locationParts = [location.name, location.admin1, location.country].filter(
		(part): part is string => part !== undefined && part.length > 0,
	);

	return {
		locationLabel: locationParts.join(', '),
		timezone: weather.timezone,
		temperatureUnit: units === 'fahrenheit' ? 'F' : 'C',
		windUnit: units === 'fahrenheit' ? 'mph' : 'km/h',
		precipUnit: units === 'fahrenheit' ? 'in' : 'mm',
		current: {
			time: weather.current.time,
			temperature: weather.current.temperature_2m,
			feelsLike: weather.current.apparent_temperature,
			humidity: weather.current.relative_humidity_2m,
			precipitation: weather.current.precipitation,
			weatherCode: weather.current.weather_code,
			windSpeed: weather.current.wind_speed_10m,
			windDirection: weather.current.wind_direction_10m,
		},
		nextHours,
		nextDays,
		sparklineSeries,
	};
};

const renderWeatherDashboard = (frame: Frame, data: DashboardData, runtime: LiveRuntime): void => {
	const rootLayout = createLayout([lengthConstraint(3), fillConstraint(1), lengthConstraint(5)]);
	const [headerArea = frame.area, bodyArea = frame.area, footerArea = frame.area] = splitLayout(
		rootLayout,
		frame.area,
	);

	const tabs = createTabs(['Current', 'Hourly', '5-Day'], {
		selected: 0,
		block: blockBordered({
			titles: [createTitle('Weather Dashboard', { alignment: 'center' })],
			borderStyle: styleFg(createStyle(), Color.LightBlue),
		}),
		style: styleFg(createStyle(), Color.Gray),
		highlightStyle: styleAddModifier(styleFg(createStyle(), Color.LightCyan), Modifier.BOLD),
	});
	frameRenderWidget(frame, renderTabs(tabs), headerArea);

	const bodyLayout = createLayout([lengthConstraint(38), fillConstraint(1)], {
		direction: 'horizontal',
	});
	const [leftArea = bodyArea, rightArea = bodyArea] = splitLayout(bodyLayout, bodyArea);

	const leftLayout = createLayout([
		fillConstraint(1),
		lengthConstraint(3),
		lengthConstraint(3),
		lengthConstraint(3),
	]);
	const [
		summaryArea = leftArea,
		humidityArea = leftArea,
		rainArea = leftArea,
		windArea = leftArea,
	] = splitLayout(leftLayout, leftArea);
	const summaryAccent = weatherAccentColor(data.current.weatherCode);

	const currentSummary = [
		data.locationLabel,
		weatherLabel(data.current.weatherCode),
		`Now: ${data.current.temperature.toFixed(1)} ${data.temperatureUnit}`,
		`Feels: ${data.current.feelsLike.toFixed(1)} ${data.temperatureUnit}`,
		`Precip: ${data.current.precipitation.toFixed(2)} ${data.precipUnit}`,
		`Wind: ${data.current.windSpeed.toFixed(1)} ${data.windUnit}`,
		`Direction: ${Math.round(data.current.windDirection)} deg`,
		`Local: ${formatClock(runtime.now, data.timezone)}`,
		`Observed: ${data.current.time}`,
	].join('\n');

	const summary = createParagraph(currentSummary, {
		block: blockBordered({
			titles: [createTitle('Current Conditions')],
			borderStyle: styleFg(createStyle(), summaryAccent),
		}),
		style: styleFg(createStyle(), Color.Gray),
		wrap: { trim: true },
	});
	frameRenderWidget(frame, renderParagraph(summary), summaryArea);

	const next12Hours = data.nextHours.slice(0, 12);
	const maxRainChance = next12Hours.reduce((max, point) => Math.max(max, point.rainChance), 0);

	const humidityGauge = gaugePercent(clamp(data.current.humidity, 0, 100), {
		block: blockBordered({
			titles: [createTitle('Humidity')],
			borderStyle: styleFg(createStyle(), Color.Cyan),
		}),
		useUnicode: true,
		style: styleFg(createStyle(), Color.DarkGray),
		gaugeStyle: styleFg(createStyle(), Color.Cyan),
	});
	frameRenderWidget(frame, renderGauge(humidityGauge), humidityArea);

	const rainGauge = gaugePercent(clamp(maxRainChance, 0, 100), {
		block: blockBordered({
			titles: [createTitle('Rain Chance (12h max)')],
			borderStyle: styleFg(createStyle(), Color.LightBlue),
		}),
		useUnicode: true,
		style: styleFg(createStyle(), Color.DarkGray),
		gaugeStyle: styleFg(createStyle(), Color.Blue),
	});
	frameRenderWidget(frame, renderGauge(rainGauge), rainArea);

	const windScale = data.windUnit === 'mph' ? 60 : 100;
	const windRatio = clamp((data.current.windSpeed / windScale) * 100, 0, 100);
	const windGauge = gaugePercent(windRatio, {
		block: blockBordered({
			titles: [createTitle(`Wind (scale ${windScale} ${data.windUnit})`)],
			borderStyle: styleFg(createStyle(), Color.LightYellow),
		}),
		useUnicode: true,
		style: styleFg(createStyle(), Color.DarkGray),
		gaugeStyle: styleFg(createStyle(), Color.LightYellow),
	});
	frameRenderWidget(frame, renderGauge(windGauge), windArea);

	const rightLayout = createLayout([fillConstraint(1), lengthConstraint(7)]);
	const [hourlyArea = rightArea, sparklineArea = rightArea] = splitLayout(rightLayout, rightArea);

	const hourlyRows = data.nextHours
		.slice(0, 8)
		.map((hour) =>
			createRow([
				formatHour(hour.time),
				`${hour.temperature.toFixed(1)} ${data.temperatureUnit}`,
				`${Math.round(hour.rainChance)}%`,
				`${Math.round(hour.windSpeed)} ${data.windUnit}`,
			]),
		);

	const hourlyTable = createTable(
		hourlyRows,
		[lengthConstraint(6), lengthConstraint(10), lengthConstraint(6), lengthConstraint(12)],
		{
			header: createRow(['Time', 'Temp', 'Rain', 'Wind'], {
				style: styleAddModifier(styleFg(createStyle(), Color.LightGreen), Modifier.BOLD),
			}),
			block: blockBordered({
				titles: [createTitle('Next 8 Hours')],
				borderStyle: styleFg(createStyle(), Color.LightBlue),
			}),
			style: styleFg(createStyle(), Color.Gray),
		},
	);
	frameRenderWidget(frame, renderTable(hourlyTable), hourlyArea);

	const sparkline = createSparkline(data.sparklineSeries, {
		block: blockBordered({
			titles: [createTitle('24h Temperature Trend')],
			borderStyle: styleFg(createStyle(), Color.LightMagenta),
		}),
		style: styleFg(createStyle(), Color.LightMagenta),
	});
	frameRenderWidget(frame, renderSparkline(sparkline), sparklineArea);

	const daySummary = data.nextDays
		.map(
			(day) =>
				`${formatDay(day.date)} ${day.max.toFixed(0)}/${day.min.toFixed(0)} ${data.temperatureUnit} ${Math.round(day.rainChance)}% ${weatherLabel(day.weatherCode)}`,
		)
		.join(' | ');

	const statusColor = runtime.errorMessage
		? Color.LightRed
		: runtime.loading
			? Color.LightYellow
			: Color.Green;
	const statusLabel = runtime.errorMessage
		? `error ${spinnerFrame(runtime.tick)}`
		: runtime.loading
			? `refreshing ${spinnerFrame(runtime.tick)}`
			: `live ${spinnerFrame(runtime.tick)}`;
	const statusLine = [
		`Status: ${statusLabel}`,
		`Updated: ${formatAgeSeconds(runtime.now, runtime.lastUpdatedAt)}`,
		`Next refresh: ${runtime.nextRefreshSeconds}s`,
		'Press q to quit',
	].join(' | ');
	const errorLine = runtime.errorMessage === undefined ? '' : `Last error: ${runtime.errorMessage}`;

	const footerText = [`Timezone: ${data.timezone}`, daySummary, statusLine, errorLine]
		.filter((line) => line.length > 0)
		.join('\n');

	const footer = createParagraph(footerText, {
		block: blockBordered({
			titles: [createTitle('Forecast')],
			borderStyle: styleFg(createStyle(), statusColor),
		}),
		style: styleFg(createStyle(), Color.Gray),
		wrap: { trim: true },
	});
	frameRenderWidget(frame, renderParagraph(footer), footerArea);
};

const renderLoadingDashboard = (
	frame: Frame,
	city: string,
	runtime: LiveRuntime,
	timezone?: string,
): void => {
	const borderColor = runtime.errorMessage === undefined ? Color.LightBlue : Color.LightRed;
	const statusLine =
		runtime.errorMessage === undefined
			? `Loading weather ${spinnerFrame(runtime.tick)}`
			: `Retrying in ${runtime.nextRefreshSeconds}s`;
	const lines = [
		`City: ${city}`,
		timezone === undefined ? '' : `Timezone: ${timezone}`,
		statusLine,
		runtime.errorMessage === undefined ? '' : `Error: ${runtime.errorMessage}`,
		'Press q to quit',
	]
		.filter((line) => line.length > 0)
		.join('\n');

	const panel = createParagraph(lines, {
		block: blockBordered({
			titles: [createTitle('Weather Dashboard')],
			borderStyle: styleFg(createStyle(), borderColor),
		}),
		style: styleFg(createStyle(), Color.Gray),
		wrap: { trim: true },
		alignment: 'center',
	});

	frameRenderWidget(frame, renderParagraph(panel), frame.area);
};

const runSnapshotDashboard = async (
	location: GeocodeResult,
	options: CliOptions,
): Promise<void> => {
	const weather = await fetchWeather(location, options.units);
	const data = buildDashboardData(location, weather, options.units);

	const state = createTestBackendState(options.width, options.height);
	const backend = createTestBackend(state);
	const terminal = createTerminal(backend);
	const now = new Date();

	terminalDraw(terminal, (frame) => {
		renderWeatherDashboard(frame, data, {
			now,
			tick: 0,
			refreshSeconds: options.refreshSeconds,
			nextRefreshSeconds: options.refreshSeconds,
			loading: false,
			lastUpdatedAt: now,
		});
	});

	if (supportsAnsiColor()) {
		process.stdout.write(`${testBackendToAnsi(state)}\n`);
	} else {
		console.log(testBackendToString(state));
	}
};

const runLiveDashboard = async (location: GeocodeResult, options: CliOptions): Promise<void> => {
	const backend = createNodeBackend();
	const terminal = createTerminal(backend);
	const frameDelayMs = Math.max(33, Math.floor(1000 / options.fps));
	const refreshMs = options.refreshSeconds * 1000;

	let running = true;
	let tick = 0;
	let dashboardData: DashboardData | undefined;
	let loading = false;
	let lastUpdatedAt: Date | undefined;
	let lastRequestAt = 0;
	let errorMessage: string | undefined;

	const refreshWeatherData = async (): Promise<void> => {
		if (loading) {
			return;
		}

		loading = true;
		lastRequestAt = Date.now();
		try {
			const weather = await fetchWeather(location, options.units);
			dashboardData = buildDashboardData(location, weather, options.units);
			lastUpdatedAt = new Date();
			errorMessage = undefined;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			errorMessage = message;
		} finally {
			loading = false;
		}
	};

	const stopInput = attachQuitKeyListener(() => {
		running = false;
	});
	const onResize = (): void => {
		terminalResize(terminal, backend.size());
	};
	const onSignal = (): void => {
		running = false;
	};

	process.stdout.on('resize', onResize);
	process.on('SIGINT', onSignal);
	process.on('SIGTERM', onSignal);

	enterAlternateScreen();
	terminalResize(terminal, backend.size());

	try {
		await refreshWeatherData();

		while (running) {
			const now = new Date();
			const nowMs = now.getTime();
			if (!loading && nowMs - lastRequestAt >= refreshMs) {
				void refreshWeatherData();
			}

			const nextRefreshSeconds = loading
				? 0
				: Math.max(0, Math.ceil((refreshMs - (nowMs - lastRequestAt)) / 1000));

			const runtime: LiveRuntime = {
				now,
				tick,
				refreshSeconds: options.refreshSeconds,
				nextRefreshSeconds,
				loading,
				lastUpdatedAt,
				errorMessage,
			};

			terminalDraw(terminal, (frame) => {
				if (dashboardData === undefined) {
					renderLoadingDashboard(frame, location.name, runtime, location.timezone);
					return;
				}
				renderWeatherDashboard(frame, dashboardData, runtime);
			});

			tick++;
			await sleep(frameDelayMs);
		}
	} finally {
		process.stdout.off('resize', onResize);
		process.off('SIGINT', onSignal);
		process.off('SIGTERM', onSignal);
		stopInput();
		exitAlternateScreen();
	}
};

const main = async (): Promise<void> => {
	let options: CliOptions;
	try {
		options = parseCliOptions(process.argv.slice(2));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Error: ${message}`);
		console.error('');
		printHelp();
		process.exit(1);
		return;
	}

	try {
		const location = await findLocation(options.city);
		if (
			options.once ||
			process.stdout.isTTY !== true ||
			process.stdin.isTTY !== true ||
			typeof process.stdin.setRawMode !== 'function'
		) {
			await runSnapshotDashboard(location, options);
			return;
		}

		await runLiveDashboard(location, options);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Failed to render weather dashboard: ${message}`);
		process.exit(1);
	}
};

void main();
