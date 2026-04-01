#include <TinyGPSPlus.h>
#include <SPI.h>
#include <LoRa.h>
#include <Wire.h>
#include <QMC5883LCompass.h>

TinyGPSPlus gps;
QMC5883LCompass compass;

#define RXD2 16
#define TXD2 17

HardwareSerial gpsSerial(2);

#define ss 5
#define rst 14
#define dio0 26

void setup()
{
  Serial.begin(115200);

  gpsSerial.begin(9600, SERIAL_8N1, RXD2, TXD2);

  Wire.begin();
  compass.init();

  LoRa.setPins(ss, rst, dio0);

  if (!LoRa.begin(433E6))
  {
    Serial.println("LoRa init failed");
    while (1);
  }

  Serial.println("LoRa Ready");
}

void loop()
{
  while (gpsSerial.available())
  {
    gps.encode(gpsSerial.read());
  }

  compass.read();
  int heading = compass.getAzimuth();

  if (gps.location.isUpdated())
  {
    float lat = gps.location.lat();
    float lon = gps.location.lng();

    String data = String(lat,6) + "," + String(lon,6) + "," + String(heading);

    LoRa.beginPacket();
    LoRa.print(data);
    LoRa.endPacket();

    Serial.print("Sent: ");
    Serial.println(data);
  }

  delay(2000);
}
