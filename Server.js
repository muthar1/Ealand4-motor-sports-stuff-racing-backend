// Initialize Passport middleware
app.use(passport.initialize());

require("./routes")(app);
app.get("/can-test", async (req, res) => {
  const processMessages = async () => {
    const startDate = "2025-01-26 21:21:00";
    const endDate = "2025-01-27 23:59:59";
    // const startDate = '2024-09-13 21:21:00';
    // const endDate = '2024-09-13 23:59:59';
    // const startDate = '2024-12-08 21:21:00';
    // const endDate = '2024-12-10 23:59:59';
    console.log("wait ...................");
    const canMessages = await CanMessages.findAll({
      where: {
        server_time: {
          [Op.between]: [startDate, endDate],
        },
      },
      order: [["server_time", "ASC"]],
    });
    for (let counter = 0; counter < canMessages.length; counter++) {
      if (canMessages[counter]) {
        try {
          const newMessage = {
            uniq_id: uuidv4(),
            car_id: canMessages[counter].car_id || "0",
            can_id: canMessages[counter].can_id,
            can_data: canMessages[counter].can_data,
            can_time_low: canMessages[counter].can_time_low,
            can_time_high: "0",
            server_time: canMessages[counter].server_time,
          };

          setTimeout(() => {
            axios
              .put(
                DATA_STREAM_URL.replace(
                  ":datastreamPrivateToken",
                  DATA_STREAM_TEST_PRIVATE_TOKEN
                ),
                newMessage,
                { headers: { "Content-Type": "application/json" } }
              )
              .then((response) => {
                console.log(
                  "Data sent to Singular.live:",
                  response.config.data
                );
              })
              .catch((error) => {
                console.error(
                  "Error sending data to Singular.live:",
                  error.message
                );
              });

            io.emit("broadcast", newMessage);
          }, counter * 20);
        } catch (error) {
          console.error("Error creating new message:", error);
        }
      }
    }
  };

  await processMessages();
  res.status(200).json("decode");
});

io.on("connection", (socket) => {
  // console.log(socket.client);
  console.log("A client connected");
  socket.on("disconnect", () => {
    console.log("A client disconnected");
  });
});

// const UDPPORT = process.env.UDP_PORT || 8080;
const UDP_PORTS = [8080, 55000, 55111, 55222, 55333, 55444, 55555, 55666];

// Initialize UDP servers for each car
const initializeUDPServers = async () => {
  try {
    // Get all cars from the database
    const cars = await Cars.findAll({
      where: { udp_port: { [Op.not]: null } },
    });

    cars.forEach((car) => {
      if (!car.udp_port) return;

      const UDPserver = dgram.createSocket("udp4");

      UDPserver.on("error", (err) => {
        console.log(`Server error on port ${car.udp_port}:\n${err.stack}`);
        UDPserver.close();
      });

      UDPserver.on("message", async (msg, rinfo) => {
        try {
          const message = msg.toString("hex");
          writeToLogFile(message + " ---- " + rinfo);
          console.log(
            "PORT: ",
            car.udp_port,
            ";;;message: ",
            message,
            ";;;rinfo: ",
            rinfo
          );

          let decodedMessage = decodeCANMessage(message);
          if (decodedMessage) {
            const newMessage = await CanMessages.create({
              car_id: car.car_id,
              can_id: decodedMessage.CanID,
              can_data: decodedMessage.canData,
              can_time_low: decodedMessage.timeStampLow.toString(),
              can_time_high: "0",
            });

            if (newMessage && newMessage.uniq_id) {
              console.log("newMessage", newMessage);

              // Send data to Singular.live using car's private token
              axios
                .put(
                  DATA_STREAM_URL.replace(
                    ":datastreamPrivateToken",
                    car.singular_private_token
                  ),
                  newMessage,
                  { headers: { "Content-Type": "application/json" } }
                )
                .then((response) => {})
                .catch((error) => {
                  console.error(
                    "Error sending data to Singular.live:",
                    error.message
                  );
                });

              // Emit socket event using car_id
              io.emit(car.car_id, newMessage);
            } else {
              console.log("no row effected", newMessage);
            }
          }
        } catch (err) {
          console.log(err);
        }
      });

      UDPserver.on("listening", () => {
        const address = UDPserver.address();
        console.log(
          `UDP server listening on ${address.port} for car ${car.car_id} -- ${car.car_name}`
        );
      });

      UDPserver.bind(car.udp_port);
    });
  } catch (error) {
    console.error("Error initializing UDP servers:", error);
  }
};

const PORT = process.env.HTTP_PORT || 8080;
server.listen(PORT, async () => {
  console.log(`HTTP Server listening on ${PORT}`);
  await initializeDatabase();
  await initializeUDPServers();
});
