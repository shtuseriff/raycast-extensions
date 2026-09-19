import { Color, Detail, getPreferenceValues, Icon } from "@raycast/api";
import { useFetch } from "@raycast/utils";
import moment from "moment";
import { Distance } from "./types/Distance";
import { Info } from "./types/Info";
import { TirePressures } from "./types/TirePressures";
import { BASE_URL } from "./utils/constants";
import { getDistance } from "./utils/utils";

type TemperatureType = "fahrenheit" | "celsius";

const tempConversion = (celsius: number, tempType: TemperatureType): number =>
  tempType === "fahrenheit" ? Math.round((celsius * 9) / 5 + 32) : Math.round(celsius);

const boolToString = (value: boolean): string => (value ? "On" : "Off");

const formatCarModelName = (modelName: string): string => {
  modelName = modelName.replace(/([0-9]+)/, " $1");
  return modelName.charAt(0).toUpperCase() + modelName.slice(1);
};

export default function CarStatus() {
  const preferences = getPreferenceValues<{
    tessieApiKey: string;
    VIN: string;
    temperature: TemperatureType;
    distance: Distance;
  }>();

  const API_KEY = preferences.tessieApiKey;
  const VIN = preferences.VIN;
  const tempType = preferences.temperature;
  const distanceType = preferences.distance;
  const tempUnit = tempType === "fahrenheit" ? "°F" : "°C";

  const headers = { Authorization: `Bearer ${API_KEY}` };

  const { isLoading, data } = useFetch<Info>(`${BASE_URL}/${VIN}/state`, { headers });
  const { data: tires } = useFetch<TirePressures>(`${BASE_URL}/${VIN}/tire_pressure`, { headers });

  if (isLoading && !data) return <Detail isLoading={true} />;
  if (!data) return <Detail markdown="Failed to fetch your car data" />;

  // Top-level vehicle state: online / asleep / offline
  const status = data.state.charAt(0).toUpperCase() + data.state.slice(1);

  // Activity from the gear selector
  const shift = data.drive_state?.shift_state;
  const speed = data.drive_state?.speed;
  const gearMap: Record<string, string> = { P: "Parked", R: "Reverse", N: "Neutral", D: "Driving" };
  let activity = "Parked";
  if (shift && gearMap[shift]) {
    activity = gearMap[shift];
    if ((shift === "D" || shift === "R") && speed != null) {
      const speedLabel = distanceType === "miles" ? "mph" : "km/h";
      activity += ` — ${Math.round(getDistance(speed, distanceType))} ${speedLabel}`;
    }
  }

  // Battery + range
  const battery = `${data.charge_state.battery_level}% (${
    data.charge_state.usable_battery_level
  }% usable) — ${getDistance(data.charge_state.battery_range, distanceType).toFixed(0)} ${distanceType}`;

  // Charging
  const chargeState = data.charge_state.charging_state;
  const isCharging = chargeState === "Charging";
  let charging = chargeState;
  if (isCharging) {
    const parts = [`${data.charge_state.charger_power} kW`];
    if (data.charge_state.charger_actual_current) parts.push(`${data.charge_state.charger_actual_current} A`);
    if (data.charge_state.charge_energy_added) parts.push(`+${data.charge_state.charge_energy_added} kWh`);
    if (data.charge_state.minutes_to_full_charge) {
      const m = data.charge_state.minutes_to_full_charge;
      parts.push(`${Math.floor(m / 60)}h ${m % 60}m to full`);
    }
    charging = `Charging — ${parts.join(", ")}`;
  }

  // Climate
  const inside = data.climate_state.inside_temp;
  const outside = data.climate_state.outside_temp;
  const climateParts = [boolToString(data.climate_state.is_climate_on)];
  if (inside != null) climateParts.push(`${tempConversion(inside, tempType)}${tempUnit} inside`);
  if (outside != null) climateParts.push(`${tempConversion(outside, tempType)}${tempUnit} outside`);
  const climate = climateParts.join(" — ");

  // Openings (0 = closed)
  const vs = data.vehicle_state;
  const open: string[] = [];
  if (vs.df || vs.dr || vs.pf || vs.pr) open.push("doors");
  if (vs.fd_window || vs.fp_window || vs.rd_window || vs.rp_window) open.push("windows");
  if (vs.ft) open.push("frunk");
  if (vs.rt) open.push("trunk");
  const openings = open.length ? `Open: ${open.join(", ")}` : "All closed";

  // Software update
  const update = vs.software_update;
  let software = `v${vs.car_version?.split(" ")[0] ?? "Unknown"}`;
  if (update?.status && update.status !== "" && update.status !== "available") {
    software += ` — update ${update.status}`;
  } else if (update?.status === "available") {
    software += " — update available";
  }

  // Tires (bar -> PSI)
  const toPsi = (bar: number) => Math.round(bar * 14.5038);
  const tirePressures = tires
    ? `FL ${toPsi(tires.front_left)} · FR ${toPsi(tires.front_right)} · RL ${toPsi(tires.rear_left)} · RR ${toPsi(
        tires.rear_right
      )} PSI`
    : "Unavailable";

  const lastUpdated = data.charge_state.timestamp ? moment(data.charge_state.timestamp).fromNow() : "Unknown";

  const markdown = `
# ${data.display_name}

${formatCarModelName(data.vehicle_config.car_type)}

**${status}** · ${activity}
`;

  const accent = status === "Online" ? Color.Green : status === "Asleep" ? Color.Blue : Color.SecondaryText;

  return (
    <Detail
      isLoading={isLoading}
      markdown={markdown}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Status" icon={Icon.Dot} text={{ value: status, color: accent }} />
          <Detail.Metadata.Label title="Activity" text={activity} />
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label
            title="Battery"
            icon={Icon.Battery}
            text={{ value: battery, color: isCharging ? Color.Green : Color.PrimaryText }}
          />
          <Detail.Metadata.Label
            title="Charging"
            icon={Icon.Bolt}
            text={{ value: charging, color: isCharging ? Color.Green : Color.PrimaryText }}
          />
          <Detail.Metadata.Label title="Charge Limit" text={`${data.charge_state.charge_limit_soc}%`} />
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label title="Climate" icon={Icon.Temperature} text={climate} />
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label
            title="Security"
            icon={vs.locked ? Icon.Lock : Icon.LockUnlocked}
            text={`${vs.locked ? "Locked" : "Unlocked"} — Sentry ${boolToString(vs.sentry_mode)}`}
          />
          <Detail.Metadata.Label title="Openings" text={openings} />
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label
            title="Odometer"
            text={`${getDistance(vs.odometer, distanceType).toLocaleString(undefined, {
              maximumFractionDigits: 0,
            })} ${distanceType}`}
          />
          <Detail.Metadata.Label title="Tire Pressure" text={tirePressures} />
          <Detail.Metadata.Label title="Software" text={software} />
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label title="Last Updated" text={lastUpdated} />
        </Detail.Metadata>
      }
    />
  );
}
