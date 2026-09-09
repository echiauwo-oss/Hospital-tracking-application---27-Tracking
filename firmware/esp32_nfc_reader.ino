#include <SPI.h>
#include <MFRC522.h>

#define SS_PIN   7
#define RST_PIN  3
#define SCK_PIN  4
#define MISO_PIN 5
#define MOSI_PIN 6

MFRC522 rfid(SS_PIN, RST_PIN);

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("[BOOT] RC522 debug starting...");

  SPI.begin(SCK_PIN, MISO_PIN, MOSI_PIN, SS_PIN);
  rfid.PCD_Init();

  byte v = rfid.PCD_ReadRegister(MFRC522::VersionReg);

  Serial.print("[DEBUG] VersionReg = 0x");
  Serial.println(v, HEX);

  if (v == 0x00 || v == 0xFF) {
    Serial.println("[ERROR] RC522 not communicating over SPI.");
  } else {
    Serial.println("[OK] RC522 is responding.");
  }

  Serial.println("[READY] Waiting for RFID tag...");
}

void loop() {
  if (!rfid.PICC_IsNewCardPresent()) {
    delay(100);
    return;
  }

  Serial.println("[DEBUG] Card present detected");

  if (!rfid.PICC_ReadCardSerial()) {
    Serial.println("[DEBUG] Failed to read serial");
    delay(100);
    return;
  }

  Serial.print("UID:");
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) Serial.print("0");
    Serial.print(rfid.uid.uidByte[i], HEX);
    if (i < rfid.uid.size - 1) Serial.print(":");
  }
  Serial.println();

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();

  delay(1500);
}
