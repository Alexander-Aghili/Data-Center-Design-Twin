# Workload layer

The workload layer records what the compute is for: training, inference or a mix, plus a compute target. In the engine it sets the peak-to-average power factor that the power layer applies to busways and breakers.

## What it is

Training and inference draw power differently. A large synchronous training job alternates between compute phases, where GPUs run near their thermal design power (TDP), and communication phases, where they drop toward idle [1]. Thousands of GPUs do this in lockstep, so the whole hall swings together. Inference traffic comes from many independent requests, so its load is smoother at hall scale. The workload choice also tints racks in the 3D view so you can see which rows serve which purpose.

## When to use it

- Set it before sizing busways and choosing an oversubscription allowance.
- Revisit it when a hall changes purpose, for example from inference to a training cluster.
- Use the compute target to see whether the placed racks meet demand under the grid cap.

## Textbook numbers

- Swing period: from about once per second to once every tens of seconds, depending on job scale; measured energy concentrates between 0.2 and 3 Hz [1].
- Swing size: aggregate power in one data center can move by tens of megawatts, and at the largest scale by hundreds [1].
- GPU share: GPUs are more than 50% of provisioned server power on GB200 [1].
- Mitigation cost: holding a GPU power floor of 90% of TDP cost 10.5% extra energy in the paper's simulation [1].
- Hardware smoothing: GB300 NVL72 power shelves carry 65 J of capacitor storage per GPU, which cut the peak seen by the grid by 30% in an NVIDIA Megatron training test [2].

## Interactions with other layers

- Power: the peak-to-average factor raises the effective busway load. A busway at 85% of rating on average can exceed its breaker on synchronized peaks.
- Compute: the target compute decides how many racks you need; the grid cap decides how many you can run.
- Cooling: heat follows power with thermal lag, so short swings matter for breakers but barely for chillers. Long job start and stop events do reach the plant.
- Network: training needs a high-bandwidth, low-oversubscription fabric; inference tolerates more oversubscription.

## What to watch for

- Mixed halls where a training cluster shares busways with inference racks. The shared busway sees the training swing on top of the inference base load.
- Job start and job end. Thousands of GPUs ramping together are a large, sudden step for the grid; NVIDIA's ramp-up limits and ramp-down "burn" mode exist for this [2].
- Utility limits on ramp rates and oscillation. The paper's example specification caps the share of power-swing energy in the 0.1 to 20 Hz band [1].

## Typical failure modes

- Breakers trip mid-training-run on a busway that passed on average load.
- A plan sized for inference is reused for training with the same oversubscription allowance.
- Power smoothing disabled or misconfigured, so the facility sees the raw swing.

## Sources

1. Microsoft, OpenAI and NVIDIA, "Power Stabilization for AI Training Datacenters", arXiv:2508.14318, https://arxiv.org/html/2508.14318v1 (textbook)
2. NVIDIA Developer Blog, "How New GB300 NVL72 Features Provide Steady Power for AI", https://developer.nvidia.com/blog/how-new-gb300-nvl72-features-provide-steady-power-for-ai/ (vendor)
