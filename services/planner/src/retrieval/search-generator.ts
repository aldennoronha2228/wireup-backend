import type { SearchQuery } from "./tavily-client";

/**
 * Extract the hardware platform from the user prompt.
 */
function extractPlatform(prompt: string): string {
  const platformMap: Record<string, string[]> = {
    esp32: ["esp32", "espressif"],
    "raspberry-pi": ["raspberry", "rpi"],
    arduino: ["arduino", "avr"],
    stm32: ["stm32", "cortex"],
    "teensy": ["teensy"],
  };

  for (const [platform, keywords] of Object.entries(platformMap)) {
    if (keywords.some((kw) => prompt.toLowerCase().includes(kw))) {
      return platform;
    }
  }

  return "";
}

/**
 * Extract sensor and component types from the prompt.
 */
function extractSensorKeywords(prompt: string): string[] {
  const sensorKeywords: Record<string, string[]> = {
    temperature: [
      "temperature",
      "dht",
      "dht22",
      "ds18b20",
      "bme280",
      "bmp280",
    ],
    humidity: ["humidity", "dht"],
    motion: ["motion", "pir", "hc-sr501"],
    distance: ["distance", "ultrasonic", "hc-sr04"],
    light: ["light", "lux", "bh1750"],
    pressure: ["pressure", "bmp", "bme"],
    gas: ["gas", "air quality", "mq"],
    accelerometer: ["accelerometer", "gyro", "mpu", "imu"],
    moisture: ["moisture", "soil"],
    co2: ["co2", "carbon dioxide", "mh-z19"],
    relay: ["relay", "switch"],
    servo: ["servo", "motor"],
    led: ["led", "light"],
    buzzer: ["buzzer", "beep"],
  };

  const found = new Set<string>();
  for (const [sensor, keywords] of Object.entries(sensorKeywords)) {
    if (keywords.some((kw) => prompt.toLowerCase().includes(kw))) {
      found.add(sensor);
    }
  }

  return Array.from(found);
}

/**
 * Generate focused Tavily search queries from a user prompt.
 * Returns multiple queries that target different aspects of the hardware project.
 */
export function generateSearchQueries(prompt: string): SearchQuery[] {
  const platform = extractPlatform(prompt);
  const sensors = extractSensorKeywords(prompt);
  const queries: SearchQuery[] = [];

  // Add platform-specific base queries
  if (platform) {
    queries.push({
      query: `${platform} ${prompt} hardware components wiring`,
      maxResults: 8,
      includeAnswer: true,
    });
    queries.push({
      query: `${platform} GPIO pinout datasheet`,
      maxResults: 5,
      includeAnswer: false,
    });
    queries.push({
      query: `${platform} I2C SPI communication protocol`,
      maxResults: 5,
      includeAnswer: false,
    });
  }

  // Add sensor-specific queries
  for (const sensor of sensors) {
    if (platform) {
      queries.push({
        query: `${platform} ${sensor} wiring connection GPIO`,
        maxResults: 5,
        includeAnswer: false,
      });
      queries.push({
        query: `${platform} ${sensor} Arduino library example`,
        maxResults: 5,
        includeAnswer: false,
      });
    } else {
      queries.push({
        query: `${sensor} hardware wiring Arduino ESP32 Raspberry Pi`,
        maxResults: 5,
        includeAnswer: true,
      });
    }

    // Add datasheet and official doc queries
    queries.push({
      query: `${sensor} datasheet pinout voltage requirements`,
      maxResults: 3,
      includeAnswer: false,
    });
  }

  // Add project-level queries
  queries.push({
    query: `${prompt} hardware setup assembly guide`,
    maxResults: 5,
    includeAnswer: true,
  });

  if (platform) {
    queries.push({
      query: `${platform} power requirements voltage regulation`,
      maxResults: 3,
      includeAnswer: false,
    });
    queries.push({
      query: `${platform} ${prompt} GitHub example project`,
      maxResults: 3,
      includeAnswer: false,
    });
  }

  // Deduplicate and limit
  const seen = new Set<string>();
  return queries
    .filter((q) => {
      if (seen.has(q.query)) return false;
      seen.add(q.query);
      return true;
    })
    .slice(0, 12); // Limit to 12 queries
}

/**
 * Generate summary queries for quick fact-checking.
 */
export function generateFastQueries(prompt: string): SearchQuery[] {
  const platform = extractPlatform(prompt);
  const sensors = extractSensorKeywords(prompt);

  if (!platform || sensors.length === 0) {
    return [
      {
        query: `${prompt} hardware components list`,
        maxResults: 3,
        includeAnswer: true,
      },
    ];
  }

  return [
    {
      query: `${platform} ${sensors.slice(0, 2).join(" ")} wiring guide`,
      maxResults: 5,
      includeAnswer: true,
    },
  ];
}
