// -----------------------------------------------------------------------------
// Entry point: SDK wiring only. Every handler is registered BEFORE connect(),
// and delegates to the EcoDevicesApp (src/app.js). Read-only: no command
// handler, the Eco-Devices is never commanded.
//
// Environment variables provided by the Gladys supervisor, read by the SDK:
// GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { EcoDevicesApp } from './src/app.js';
import { ACTIONS } from './src/constants.js';

const gladys = new GladysIntegration();
const app = new EcoDevicesApp({ gladys });

// --- Discovery -------------------------------------------------------------------
// The known inputs, never a read (the next one comes at its time).
gladys.onScanRequest(() => app.scan());
// A device just created: its values come at the next read.
gladys.onDeviceCreated((device) => app.onDeviceCreated(device));
gladys.onDeviceUpdated((device) => app.onDeviceUpdated(device));
// A device deleted: the index state of its input goes with it.
gladys.onDeviceDeleted((device) => app.onDeviceDeleted(device));

// --- Configuration screen buttons -----------------------------------------------
gladys.onAction(ACTIONS.TEST, () => app.testConnection());
// The only way to take an index jump held back (a save of the form never does).
gladys.onAction(ACTIONS.ACCEPT_HELD, () => app.acceptHeldIndex());

// --- Configuration changed by the user ----------------------------------------
gladys.onConfigUpdated((config) => {
  logger.info('Configuration updated: restarting');
  return app.configUpdated(config);
});

// --- Connection lifecycle ------------------------------------------------------
// Every connection (the first one and each reconnection) reads the
// configuration (tried again without end while Gladys cannot give it), then
// publishes the Discovery list and the status again, and every value at the
// next read.
gladys.on('connected', () => {
  app
    .connected(() => gladys.getConfig())
    .catch((err) => {
      logger.error(`Start failed (${err?.name ?? 'Error'})`);
    });
});
gladys.on('disconnected', () => {
  app.disconnected().catch((err) => logger.error(`Stop failed (${err?.name ?? 'Error'})`));
});
gladys.handleShutdown(() => app.stop());

logger.info('Starting the Eco-Devices integration...');
gladys.connect().catch((err) => {
  logger.error(`Initial connection failed (${err?.name ?? 'Error'})`);
  process.exit(1);
});
