/*
 * DF NRF24 Diagnostic Peer V1 — BENCH ONLY
 * Target: spare Arduino UNO/Nano + known-good nRF24
 * Wiring: CE D9 / CSN D10 / MOSI D11 / MISO D12 / SCK D13
 * Purpose: optional RF peer for DF_NRF24_Diagnostic_UNO.ino
 * RF test: CH42, 1 Mbps, Auto-ACK, address "DFRF1"
 *
 * Do NOT upload this to any stage MASTER or RX board.
 */

#include <SPI.h>

static const uint8_t CE_PIN = 9;
static const uint8_t CSN_PIN = 10;
static const uint32_t SPI_HZ = 2000000UL;

static const uint8_t R_REGISTER = 0x00;
static const uint8_t W_REGISTER = 0x20;
static const uint8_t R_RX_PAYLOAD = 0x61;
static const uint8_t FLUSH_RX = 0xE2;
static const uint8_t NOP_CMD = 0xFF;

static const uint8_t REG_CONFIG = 0x00;
static const uint8_t REG_EN_AA = 0x01;
static const uint8_t REG_EN_RXADDR = 0x02;
static const uint8_t REG_SETUP_AW = 0x03;
static const uint8_t REG_SETUP_RETR = 0x04;
static const uint8_t REG_RF_CH = 0x05;
static const uint8_t REG_RF_SETUP = 0x06;
static const uint8_t REG_STATUS = 0x07;
static const uint8_t REG_RX_ADDR_P0 = 0x0A;
static const uint8_t REG_TX_ADDR = 0x10;
static const uint8_t REG_RX_PW_P0 = 0x11;
static const uint8_t REG_FIFO_STATUS = 0x17;

static const uint8_t STATUS_RX_DR = 0x40;
static const uint8_t STATUS_TX_DS = 0x20;
static const uint8_t STATUS_MAX_RT = 0x10;
static const uint8_t FIFO_RX_EMPTY = 0x01;

uint32_t received = 0;
uint32_t badPayload = 0;
uint32_t lastReportMs = 0;

static void csnHigh() { digitalWrite(CSN_PIN, HIGH); }
static void csnLow() { digitalWrite(CSN_PIN, LOW); }
static void ceLow() { digitalWrite(CE_PIN, LOW); }
static void ceHigh() { digitalWrite(CE_PIN, HIGH); }

static uint8_t command(uint8_t cmd) {
  SPI.beginTransaction(SPISettings(SPI_HZ, MSBFIRST, SPI_MODE0));
  csnLow();
  uint8_t status = SPI.transfer(cmd);
  csnHigh();
  SPI.endTransaction();
  return status;
}

static uint8_t readReg(uint8_t reg) {
  SPI.beginTransaction(SPISettings(SPI_HZ, MSBFIRST, SPI_MODE0));
  csnLow();
  SPI.transfer(R_REGISTER | (reg & 0x1F));
  uint8_t value = SPI.transfer(NOP_CMD);
  csnHigh();
  SPI.endTransaction();
  return value;
}

static void writeReg(uint8_t reg, uint8_t value) {
  SPI.beginTransaction(SPISettings(SPI_HZ, MSBFIRST, SPI_MODE0));
  csnLow();
  SPI.transfer(W_REGISTER | (reg & 0x1F));
  SPI.transfer(value);
  csnHigh();
  SPI.endTransaction();
}

static void writeBytes(uint8_t reg, const uint8_t *data, uint8_t len) {
  SPI.beginTransaction(SPISettings(SPI_HZ, MSBFIRST, SPI_MODE0));
  csnLow();
  SPI.transfer(W_REGISTER | (reg & 0x1F));
  while (len--) SPI.transfer(*data++);
  csnHigh();
  SPI.endTransaction();
}

static void readPayload(uint8_t *data, uint8_t len) {
  SPI.beginTransaction(SPISettings(SPI_HZ, MSBFIRST, SPI_MODE0));
  csnLow();
  SPI.transfer(R_RX_PAYLOAD);
  while (len--) *data++ = SPI.transfer(NOP_CMD);
  csnHigh();
  SPI.endTransaction();
}

static bool chipConnected() {
  uint8_t aw = readReg(REG_SETUP_AW) & 0x03;
  uint8_t ch = readReg(REG_RF_CH);
  uint8_t status = command(NOP_CMD);
  return status != 0xFF && (status & 0x80) == 0 && aw >= 1 && aw <= 3 && ch <= 125;
}

static void configurePeer() {
  ceLow();
  const uint8_t addr[5] = { 'D', 'F', 'R', 'F', '1' };
  writeReg(REG_CONFIG, 0x0C); // CRC2, power down during setup
  writeReg(REG_EN_AA, 0x01);
  writeReg(REG_EN_RXADDR, 0x01);
  writeReg(REG_SETUP_AW, 0x03);
  writeReg(REG_SETUP_RETR, 0x00);
  writeReg(REG_RF_CH, 42);
  writeReg(REG_RF_SETUP, 0x06); // 1 Mbps, 0 dBm
  writeBytes(REG_RX_ADDR_P0, addr, 5);
  writeBytes(REG_TX_ADDR, addr, 5); // ACK packet uses pipe0 address
  writeReg(REG_RX_PW_P0, 4);
  writeReg(REG_STATUS, STATUS_RX_DR | STATUS_TX_DS | STATUS_MAX_RT);
  command(FLUSH_RX);
  writeReg(REG_CONFIG, 0x0F); // CRC2, PWR_UP, PRX
  delay(5);
  ceHigh();
}

static void printHello() {
  Serial.print(F("{\"type\":\"peer_hello\",\"protocol\":\"DF_NRF_DIAG_PEER_V1\",\"chip\":"));
  Serial.print(chipConnected() ? 1 : 0);
  Serial.println(F(",\"channel\":42,\"rate\":\"1Mbps\"}"));
}

static void drainRx() {
  uint8_t status = command(NOP_CMD);
  if (!(status & STATUS_RX_DR) && (readReg(REG_FIFO_STATUS) & FIFO_RX_EMPTY)) return;
  while (!(readReg(REG_FIFO_STATUS) & FIFO_RX_EMPTY)) {
    uint8_t payload[4] = {0, 0, 0, 0};
    readPayload(payload, 4);
    if (payload[0] == 0xD4 && payload[1] == 0x46) ++received;
    else ++badPayload;
  }
  writeReg(REG_STATUS, STATUS_RX_DR);
}

void setup() {
  pinMode(CE_PIN, OUTPUT);
  pinMode(CSN_PIN, OUTPUT);
  ceLow();
  csnHigh();
  Serial.begin(115200);
  SPI.begin();
  delay(100);
  configurePeer();
  printHello();
}

void loop() {
  drainRx();
  uint32_t now = millis();
  if (now - lastReportMs >= 1000) {
    lastReportMs = now;
    Serial.print(F("{\"type\":\"peer_stats\",\"received\":")); Serial.print(received);
    Serial.print(F(",\"bad\":")); Serial.print(badPayload);
    Serial.print(F(",\"chip\":")); Serial.print(chipConnected() ? 1 : 0);
    Serial.println(F("}"));
  }
}
