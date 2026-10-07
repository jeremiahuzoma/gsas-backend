import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/** Same bounds as the original controlSimulation / setSimulationSpeed validators. */
const speed = z.number().int().min(1).max(600);

export class StartSimulationDto extends createZodDto(z.object({ speed: speed.optional() })) {}
export class SimulationSpeedDto extends createZodDto(z.object({ speed })) {}
export class ForceThresholdDto extends createZodDto(
  z.object({ balance: z.number().min(0).max(10000) }),
) {}
