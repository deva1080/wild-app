// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import {ISignatureTransfer} from "../../interfaces/ISignatureTransfer.sol";

/**
 * @notice El ciclo es, 
 * 1. desde el front disparas directo a la blockchain (settleBet), esperas la confirmacion de transaccion y llamas al backend
 * 2. se le pasa el betId desde el front al backend y el backend solito resuelve la apuesta (creo que ya esta todo scripteado), retorna que confirmo la tx y retorna un success al front
 * 3. el front recive el succes (o error) y llama a lectura de ese betId (ver funcion bet(betId)). Usa los datos de bet(betId) para mostrar los resultados.
 */
interface IRPS {

    /**
     * @dev Estructura de la apuesta
     * @param choice Eleccion del jugador 0 = ROCK, 1 = PAPER, 2 = SCISSORS
     * @param outcome Resultado de la apuesta 0 = ROCK, 1 = PAPER, 2 = SCISSORS, 3 = DRAW
     * @param isDraw Indica si es un empate o no
     * @param placeBlockNumber Nuemro de bloque de la apuesta
     * @param amount Monto de la apuesta
     * @param winAmount Monto ganado
     * @param player Direccion del jugador
     * @param token Token utilizado
     * @param isSettled Indica si la apuesta se ha resuelto o esta pendiente
     */

    struct Bet {
        uint8 choice;
        uint8 outcome;
        bool isDraw;
        uint176 placeBlockNumber;
        uint128 amount;
        uint128 winAmount;
        address player;
        address token;
        bool isSettled;
    }

    /**********************
     *   WRITE FUNCTIONS  *
     **********************/


    /** 
    * @dev Funcion llamada por el front end cuando el usuario le da a play! 
    * @param side Eleccion del jugador 0 = ROCK, 1 = PAPER, 2 = SCISSORS
    * @param permit Permit de transferencia (dps te paso el script, ni te gastes demaciado con este struct)
    * @param transferDetails Detalles de la transferencia (dps te paso el script, ni te gastes demaciado con este struct)
    * @param signature Firma de la transferencia (el minikit lo hace simple)
    */
    function placeBet(
        uint8 side,
        ISignatureTransfer.PermitTransferFrom memory permit,
        ISignatureTransfer.SignatureTransferDetails calldata transferDetails,
        bytes calldata signature
    ) external;


    /**
     * @dev Funcion llamada por el bakcned despues de obtener una confirmacion de la transaccion de placedBet
     * @param betId Id de la apuesta
     * @param seed Seed de la apuesta
     */
    function _settleBet(uint256 betId, uint256 seed) external; 


    /**********************
     *   WRITE FUNCTIONS  *
     **********************/

    /** @dev Retorna el estado de una apuesta
     * @param betId Id de la apuesta
     * @return Bet struct
     */
    function bet(uint256 betId) external view returns (Bet memory);


    /** usado en el front para cambiar el boton de play, por llamada directa al backend
    * @dev Retorna el id de las apuestas pendientes del jugador. 0 = no hay apuestas pendientes X = hay apuestas pendientes
    * @param player Direccion del jugador
    */
    function pendingIdsPerPlayer(address player) external view returns (uint256);
}