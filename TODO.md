## Tasks
- Add system for each node to populate its own configuration UI (for its uniforms) automatically
- Allow custom resolution settings
- Allow more graceful resizing (don't restart the simulation, just ensure that aspect ratio is maintained and fit the canvas to the available viewport area)
- Allow custom render scaling (currently uses canvas's clientSize and multiplies by pixel density, allow a multiplier in the UI to render at 4x resolution, for example)
- Add button to save a full-resolution transparent .png of the accumulation texture (no BG, no color-correction)
- Add button to save a .png of the current canvas
- Add system that allows nodes to be added/removed from the chain
    - User can add new nodes from a dropdown list,
    - User can rearrange nodes
    - User's nodes are automatically grouped into "init", "simulation", and "render" groups
    - UI has "Recompile" button that is highlighted when nodes are added/removed, and the added nodes are visually marked to communicate that they aren't being applied to the scene yet
- Add preset save/load
    - When running in devmode locally, saving a preset should save a .json file to the presets folder, so it is added to the project permanently
    - When running in "production" presets should be saved using IndexedDB so they persist.
    - Offer an export option if users want to store their presets as actual files
- Automatically generate a seed for all of the randomized logic using the time when we start running a simulation
- Add UI option to set a specific seed

## Questions
- Should presets be both scene-level *and* node-level? Ex: should each node have its own set of presets to choose from, in addition to presents for the entire scene?
- Do we need a button to save the accumulation buffer *with* the tonemapping we perform while drawing that buffer to the canvas?
- Do we need camera controls?

## Nodes To Add
- SetAlphaOverLifetime
- SetColorOverLifetime
- SetMassOverLifetime

## Nodes to Extend
- spawnSphere
    - add continuous spawn by rate (until max count is hit)